// bePaid amounts are integers in minimal currency units (kopecks/cents).
// Conversion is done on strings to avoid floating point errors (0.1 + 0.2 problems).

const MINOR_DIGITS = 2;

/** "550", "550.5", "550,50" -> 55050. Throws on malformed or >2 decimal places. */
export function toMinorUnits(amount: string | number): number {
  const text = String(amount).trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error(`Invalid amount "${amount}": expected a positive number with up to ${MINOR_DIGITS} decimals`);
  }
  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(MINOR_DIGITS, "0");
  const minor = Number(whole) * 10 ** MINOR_DIGITS + Number(fraction);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error(`Invalid amount "${amount}": must be greater than zero`);
  }
  return minor;
}

/** 55050 -> "550.50" */
export function fromMinorUnits(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** MINOR_DIGITS);
  const fraction = String(abs % 10 ** MINOR_DIGITS).padStart(MINOR_DIGITS, "0");
  return `${sign}${whole}.${fraction}`;
}
