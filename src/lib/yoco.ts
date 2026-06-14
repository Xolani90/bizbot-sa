/**
 * Yoco payment link generation.
 * Yoco's Checkout API creates a hosted payment page URL.
 * Docs: https://developer.yoco.com/online/checkout/quick-start
 *
 * Falls back gracefully if not configured — invoice is still sent without
 * a payment link.
 */

export interface YocoLinkOptions {
  merchantId: string;
  amount: number;
  description: string;
  invoiceId: string;
}

export async function generateYocoLink(opts: YocoLinkOptions): Promise<string | null> {
  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) return null;

  // Yoco Checkout API creates a payment session
  const res = await fetch('https://payments.yoco.com/api/checkouts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(opts.amount * 100), // Yoco expects cents
      currency: 'ZAR',
      metadata: {
        invoiceId: opts.invoiceId,
        description: opts.description,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Yoco checkout error:', res.status, err);
    return null;
  }

  const data = (await res.json()) as { redirectUrl?: string; id?: string };
  return data.redirectUrl ?? null;
}
