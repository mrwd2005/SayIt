from __future__ import annotations

import asyncio
import unittest

from backend.app.partial_caption import PartialCaptionSession


def _audio(seconds: float, value: int = 1000) -> bytes:
    return value.to_bytes(2, "little", signed=True) * int(seconds * 16000)


class PartialCaptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_emits_changed_cumulative_text_only_after_interval(self) -> None:
        calls: list[int] = []
        messages: list[dict] = []

        async def transcribe(audio, _context, _language):
            calls.append(audio.size)
            return (f"text-{len(calls)}", 1, {})

        async def send_json(message):
            messages.append(message)

        session = PartialCaptionSession(
            transcribe=transcribe,
            send_json=send_json,
            enabled=True,
            min_audio_sec=0.2,
            interval_sec=0.3,
            max_audio_sec=2.0,
        )

        session.push(_audio(0.1))
        self.assertEqual(calls, [])
        session.push(_audio(0.1))
        await session.wait()
        self.assertEqual(messages, [{"type": "partial", "text": "text-1", "duration_sec": 0.2}])

        session.push(_audio(0.1))
        await session.wait()
        self.assertEqual(len(calls), 1)
        session.push(_audio(0.2))
        await session.wait()
        self.assertEqual(messages[-1]["text"], "text-2")
        await session.close()

    async def test_close_cancels_preview_and_prevents_late_send(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        messages: list[dict] = []

        async def transcribe(_audio, _context, _language):
            started.set()
            await release.wait()
            return "too late", 1, {}

        async def send_json(message):
            messages.append(message)

        session = PartialCaptionSession(
            transcribe=transcribe,
            send_json=send_json,
            enabled=True,
            min_audio_sec=0.1,
            interval_sec=0.1,
            max_audio_sec=2.0,
        )
        session.push(_audio(0.2))
        await started.wait()
        await session.close()
        release.set()
        await asyncio.sleep(0)
        self.assertEqual(messages, [])

    async def test_does_not_start_for_silence_or_when_disabled(self) -> None:
        calls = 0

        async def transcribe(_audio, _context, _language):
            nonlocal calls
            calls += 1
            return "unexpected", 1, {}

        async def send_json(_message):
            raise AssertionError("no message expected")

        session = PartialCaptionSession(
            transcribe=transcribe,
            send_json=send_json,
            enabled=True,
            min_audio_sec=0.1,
            interval_sec=0.1,
            max_audio_sec=2.0,
        )
        session.push(_audio(0.3, value=0))
        await session.wait()
        self.assertEqual(calls, 0)
        await session.close()

        disabled = PartialCaptionSession(
            transcribe=transcribe,
            send_json=send_json,
            enabled=False,
            min_audio_sec=0.1,
            interval_sec=0.1,
            max_audio_sec=2.0,
        )
        disabled.push(_audio(0.3))
        await disabled.wait()
        self.assertEqual(calls, 0)
        await disabled.close()
