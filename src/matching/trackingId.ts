import { createHash } from "node:crypto";
import { transliterate } from "./normalize.js";

// tracking_id embedded in payment links we create, e.g. "grp1|alfa-25.1|03|a1b2c3d4".
// Kept short and ASCII-only because bePaid does not document the allowed length/charset.
// The version prefix lets us change the format later without misreading old payments.
const PREFIX = "grp1";
const SEPARATOR = "|";

export interface TrackingInfo {
  groupSlug: string;
  meeting?: string;
  payerKey: string;
}

/** ASCII slug of a group code: "Альфа 25.1" -> "alfa-25.1". Used to compare tracking ids with roster groups. */
export function groupSlug(groupCode: string): string {
  const slug = transliterate(groupCode).replaceAll(/[^a-z0-9.]+/g, "-");
  // Trim leading/trailing dashes without a backtracking-prone regex.
  let start = 0;
  let end = slug.length;
  while (start < end && slug[start] === "-") start++;
  while (end > start && slug[end - 1] === "-") end--;
  return slug.slice(start, end);
}

/** Stable short key for a payer, derived from a normalized identifier (email or phone). */
export function payerKey(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex").slice(0, 8);
}

export function encodeTrackingId(info: TrackingInfo): string {
  const meeting = info.meeting ? info.meeting.padStart(2, "0") : "";
  return [PREFIX, info.groupSlug, meeting, info.payerKey].join(SEPARATOR);
}

/** Returns undefined for tracking ids that were not created by this server (e.g. the website's own). */
export function decodeTrackingId(trackingId: string | null | undefined): TrackingInfo | undefined {
  if (!trackingId) return undefined;
  const parts = trackingId.split(SEPARATOR);
  if (parts.length !== 4 || parts[0] !== PREFIX) return undefined;
  const [, slug, meeting, key] = parts as [string, string, string, string];
  if (!slug || !key) return undefined;
  return { groupSlug: slug, meeting: meeting || undefined, payerKey: key };
}
