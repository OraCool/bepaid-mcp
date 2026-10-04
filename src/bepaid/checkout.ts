import { BEPAID_HOSTS, BepaidClient } from "./client.js";
import { checkoutResponseSchema } from "./types.js";

export interface CheckoutRequest {
  amountMinor: number;
  currency: string;
  description: string;
  trackingId?: string;
  expiresAt: Date;
  test: boolean;
  language?: string;
  returnUrl?: string;
  customer?: { email?: string; firstName?: string; lastName?: string };
  /** Payer fields shown on the payment page and required there (settings.customer_fields.visible). */
  visibleFields?: string[];
}

export interface CheckoutLink {
  token: string;
  redirectUrl: string;
}

/** Creates a one-off payment page (checkout token). The returned redirect_url is the link sent to the payer. */
export async function createCheckout(client: BepaidClient, req: CheckoutRequest): Promise<CheckoutLink> {
  const raw = await client.request(BEPAID_HOSTS.checkout, "/ctp/api/checkouts", {
    apiVersion: "2",
    body: {
      checkout: {
        transaction_type: "payment",
        test: req.test,
        order: {
          amount: req.amountMinor,
          currency: req.currency,
          description: req.description,
          ...(req.trackingId && { tracking_id: req.trackingId }),
          expired_at: req.expiresAt.toISOString(),
        },
        settings: {
          language: req.language ?? "ru",
          ...(req.returnUrl && { return_url: req.returnUrl }),
          ...(req.visibleFields?.length && { customer_fields: { visible: req.visibleFields } }),
        },
        ...(req.customer && (req.customer.email || req.customer.firstName || req.customer.lastName) && {
          customer: {
            ...(req.customer.email && { email: req.customer.email }),
            ...(req.customer.firstName && { first_name: req.customer.firstName }),
            ...(req.customer.lastName && { last_name: req.customer.lastName }),
          },
        }),
      },
    },
  });
  const { checkout } = checkoutResponseSchema.parse(raw);
  return { token: checkout.token, redirectUrl: checkout.redirect_url };
}
