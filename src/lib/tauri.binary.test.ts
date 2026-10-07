import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "sent" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { sendMessageWithAttachment, sendVoiceMessage } from "./tauri";

describe("binary message transport", () => {
  beforeEach(() => invoke.mockClear());
  it("passes file bytes directly and encodes Unicode metadata separately", async () => {
    const bytes = new Uint8Array([0, 127, 255]);
    await sendMessageWithAttachment("account", "channel", "Olá 😄", "reply", "foto.png", undefined, bytes);
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("send_attachment_bytes");
    expect(body).toBe(bytes);
    expect(JSON.parse(decodeURIComponent(options.headers["x-organic-metadata"]))).toEqual({
      accountId: "account", channelId: "channel", content: "Olá 😄", replyTo: "reply", fileName: "foto.png",
    });
  });
  it("keeps selected native files on the streaming path", async () => {
    await sendMessageWithAttachment("account", "channel", "", undefined, "video.mp4", "handle");
    expect(invoke).toHaveBeenCalledWith("send_message_with_attachment", expect.objectContaining({ fileHandle: "handle", fileData: null }));
  });
  it("sends voice bytes with duration, waveform and reply intact", async () => {
    const bytes = new Uint8Array([1, 2]);
    await sendVoiceMessage("account", "channel", bytes, 12.5, "AA==", "reply");
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("send_voice_bytes");
    expect(body).toBe(bytes);
    expect(JSON.parse(decodeURIComponent(options.headers["x-organic-metadata"]))).toEqual({
      accountId: "account", channelId: "channel", durationSecs: 12.5, waveform: "AA==", replyTo: "reply",
    });
  });
});
