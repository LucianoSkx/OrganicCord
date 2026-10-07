import type { DiscordMember, DiscordDM, DiscordRelationship } from "@/types";

export function resolveTypingName(
  userId: string,
  member: DiscordMember | undefined,
  dms: readonly DiscordDM[],
  relationships: readonly DiscordRelationship[],
): string {
  const recipient = dms.flatMap((dm) => dm.recipients ?? []).find((user) => user.id === userId);
  const relationship = relationships.find((item) => item.user.id === userId);

  return member?.nick || member?.user?.global_name || member?.user?.username ||
    recipient?.global_name || relationship?.nickname || recipient?.username ||
    relationship?.user.global_name || relationship?.user.username || "Alguém";
}

export function formatTypingNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  if (names.length === 3) return `${names[0]}, ${names[1]} e ${names[2]} estão digitando...`;
  return `${names.slice(0, 3).join(", ")} e mais ${names.length - 3} estão digitando...`;
}
