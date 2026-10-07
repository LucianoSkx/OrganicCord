import { describe, expect, it } from "vitest";
import type { DiscordDM, DiscordRelationship } from "@/types";
import { formatTypingNames, resolveTypingName } from "./typing";

const dms: DiscordDM[] = [{
  id: "dm",
  channel_type: 1,
  recipients: [{ id: "recipient", username: "user-name", global_name: "Display Name", discriminator: "0", avatar: null }],
  last_message_id: null,
}];

const relationships: DiscordRelationship[] = [{
  id: "recipient",
  relationship_type: 1,
  nickname: "My Nickname",
  user: { id: "recipient", username: "user-name", global_name: "Display Name", discriminator: "0", avatar: null },
}];

describe("typing indicator text", () => {
  it("resolves private-chat names from recipients even without a guild member", () => {
    expect(resolveTypingName("recipient", undefined, dms, relationships)).toBe("Display Name");
  });

  it("prefers a guild nickname and falls back through available identity data", () => {
    expect(resolveTypingName("recipient", { nick: "Server Nick", roles: [], joined_at: "", deaf: false, mute: false }, dms, relationships)).toBe("Server Nick");
    expect(resolveTypingName("unknown", undefined, [], [])).toBe("Alguém");
  });

  it("formats one, two, three, and larger groups without dropping names", () => {
    expect(formatTypingNames(["Ana"])).toBe("Ana está digitando...");
    expect(formatTypingNames(["Ana", "Bia"])).toBe("Ana e Bia estão digitando...");
    expect(formatTypingNames(["Ana", "Bia", "Caio"])).toBe("Ana, Bia e Caio estão digitando...");
    expect(formatTypingNames(["Ana", "Bia", "Caio", "Dani"])).toBe("Ana, Bia, Caio e mais 1 estão digitando...");
  });
});
