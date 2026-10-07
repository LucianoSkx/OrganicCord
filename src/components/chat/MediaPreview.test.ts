import { describe, expect, it } from "vitest";
import { mediaPreviewUrl } from "./MediaPreview";
describe("message media previews", () => {
  it("bounds density and keeps signed query parameters intact", () => {
    const preview = new URL(mediaPreviewUrl("https://cdn.discordapp.com/attachments/a/b/photo.png?ex=expiry", "https://media.discordapp.net/attachments/a/b/photo.png?ex=expiry&is=issued&hm=signature", 400, 300, 4));
    expect(preview.searchParams.get("width")).toBe("1200");
    expect(preview.searchParams.get("height")).toBe("900");
    expect(preview.searchParams.get("hm")).toBe("signature");
    expect(preview.searchParams.get("ex")).toBe("expiry");
  });
  it("preserves animated GIFs and leaves unrelated hosts untouched", () => {
    const gif = "https://cdn.discordapp.com/attachments/a/b/animation.gif";
    expect(mediaPreviewUrl(gif, gif.replace("cdn.discordapp.com", "media.discordapp.net"), 400, 300)).toBe(gif);
    expect(mediaPreviewUrl("original", "https://images.example/photo.png", 400, 300)).toBe("original");
  });
});
