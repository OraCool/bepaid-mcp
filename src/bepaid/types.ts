import { z } from "zod";

// Only fields we use are declared; everything else passes through untouched (bePaid adds fields over time).

export const transactionSchema = z.looseObject({
  // Numeric in reports (used as pagination cursor); the gateway lookup returns the uid string instead.
  id: z.union([z.number(), z.string()]).optional(),
  uid: z.string(),
  type: z.string().optional(), // payment | refund | authorization | ...
  status: z.string(),
  amount: z.number(), // minimal currency units
  currency: z.string(),
  description: z.string().nullish(),
  tracking_id: z.string().nullish(),
  payment_method_type: z.string().nullish(),
  test: z.boolean().optional(),
  created_at: z.string().nullish(),
  paid_at: z.string().nullish(),
  settled_at: z.string().nullish(),
  order_id: z.union([z.number(), z.string()]).nullish(),
  transaction_fee: z.number().nullish(), // minimal currency units
  pay_to_merchant: z.number().nullish(), // amount - fee, minimal currency units
  discount_rate: z.number().nullish(), // percent
  customer: z.looseObject({ email: z.string().nullish(), ip: z.string().nullish() }).nullish(),
  billing_address: z
    .looseObject({
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      phone: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
  credit_card: z
    .looseObject({
      holder: z.string().nullish(),
      last_4: z.string().nullish(),
      brand: z.string().nullish(),
      issuer_country: z.string().nullish(), // ISO 3166 alpha-2 of the card-issuing bank
      issuer_name: z.string().nullish(),
    })
    .nullish(),
  receipt_url: z.string().nullish(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const reportPageSchema = z.looseObject({
  transactions: z.array(transactionSchema),
  count: z.number().optional(),
  has_more: z.boolean(),
  first_object_id: z.union([z.number(), z.string()]).nullish(),
  last_object_id: z.union([z.number(), z.string()]).nullish(),
});
export type ReportPage = z.infer<typeof reportPageSchema>;

export const checkoutResponseSchema = z.looseObject({
  checkout: z.looseObject({ token: z.string(), redirect_url: z.string() }),
});

export const PAYMENT_METHOD_TYPES = ["credit_card", "alternative", "erip"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export const REPORT_STATUSES = ["all", "successful", "failed", "pending", "incomplete"] as const;
export const DATE_TYPES = ["created_at", "paid_at", "settled_at"] as const;
