"""Low-cost incremental transcript previews for desktop live captions.

The local ASR backends are batch-oriented, so a preview re-transcribes a bounded
audio window on a schedule rather than exposing a fabricated token stream. The
final transcript still comes from the normal stop path and is never replaced by
these previews.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import numpy as np

logger = logging.getLogger("sayit.partial")

Transcribe = Callable[[np.ndarray, str | None, str | None], Awaitable[tuple[str, int, dict[str, Any]]]]
SendJSON = Callable[[dict[str, Any]], Awaitable[None]]

_BYTES_PER_SECOND = 32000  # 16 kHz, signed 16-bit mono
_SIGNAL_PEAK = 0.01


class PartialCaptionSession:
    """Schedules at most one ASR preview at a time for one recording."""

    def __init__(
        self,
        *,
        transcribe: Transcribe,
        send_json: SendJSON,
        enabled: bool,
        min_audio_sec: float,
        interval_sec: float,
        max_audio_sec: float,
        context: str | None = None,
        language: str | None = None,
    ) -> None:
        self._transcribe = transcribe
        self._send_json = send_json
        self._enabled = enabled
        self._min_bytes = max(1, int(min_audio_sec * _BYTES_PER_SECOND))
        self._interval_bytes = max(1, int(interval_sec * _BYTES_PER_SECOND))
        self._max_bytes = max(self._min_bytes, int(max_audio_sec * _BYTES_PER_SECOND))
        self._context = context
        self._language = language
        self._buffer = bytearray()
        self._last_attempt_bytes = 0
        self._last_text = ""
        self._task: asyncio.Task[None] | None = None
        self._closed = False

    def push(self, pcm: bytes) -> None:
        """Add PCM and start the next preview when the schedule allows it."""
        if self._closed or not self._enabled or not pcm:
            return
        self._buffer.extend(pcm)
        if len(self._buffer) < self._min_bytes:
            return
        if self._task is not None and not self._task.done():
            return
        if self._last_attempt_bytes and (
            len(self._buffer) - self._last_attempt_bytes < self._interval_bytes
        ):
            return

        self._last_attempt_bytes = len(self._buffer)
        snapshot = bytes(self._buffer[-self._max_bytes:])
        samples = np.frombuffer(snapshot, dtype=np.int16)
        if samples.size == 0:
            return
        peak = float(np.max(np.abs(samples.astype(np.int32)))) / 32768.0
        if peak < _SIGNAL_PEAK:
            return
        self._task = asyncio.create_task(self._run(snapshot), name="sayit-partial-caption")

    async def _run(self, snapshot: bytes) -> None:
        try:
            audio = np.frombuffer(snapshot, dtype=np.int16).astype(np.float32) / 32768.0
            text, _, _ = await self._transcribe(audio, self._context, self._language)
            text = text.strip()
            if self._closed or not text or text == self._last_text:
                return
            self._last_text = text
            await self._send_json(
                {
                    "type": "partial",
                    "text": text,
                    "duration_sec": round(len(audio) / 16000.0, 2),
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A preview failure must never fail the actual recording.
            logger.warning("partial caption preview failed: %s", type(exc).__name__)
        finally:
            self._task = None

    async def wait(self) -> None:
        """Wait for the active preview (used by shutdown and tests)."""
        task = self._task
        if task is None:
            return
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def close(self) -> None:
        """Cancel previews before final ASR/done messages are written."""
        self._closed = True
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
