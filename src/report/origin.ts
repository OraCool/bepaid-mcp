import type { Transaction } from "../bepaid/types.js";

// Where the money came from, by the country of the card-issuing bank. Payments from foreign banks
// have to be declared to the merchant's own bank, so every report keeps this per payment.

export type PaymentOrigin = "domestic" | "foreign" | "unknown";

export const DOMESTIC_COUNTRY = "BY";

export function paymentOrigin(tx: Transaction): { origin: PaymentOrigin; issuerCountry?: string } {
  // ERIP is the Belarusian settlement system: payments always come from Belarusian banks.
  if (tx.payment_method_type === "erip") return { origin: "domestic", issuerCountry: DOMESTIC_COUNTRY };
  const country = tx.credit_card?.issuer_country?.trim().toUpperCase();
  if (!country) return { origin: "unknown" };
  return { origin: country === DOMESTIC_COUNTRY ? "domestic" : "foreign", issuerCountry: country };
}
