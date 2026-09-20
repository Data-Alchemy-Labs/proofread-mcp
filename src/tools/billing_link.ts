import { z } from "zod";
import { defineTool, fail, ok } from "./tool.js";

export const billingLink = defineTool({
  name: "billing_link",
  title: "Get a checkout link for a paid plan",
  description:
    "Get a Stripe Checkout link that upgrades this API key's account to a paid plan (POST /agent/checkout-link). Use it when a check answers " +
    "'needs the ... plan' (402) or 'monthly allowance used' (429), or when the user asks to upgrade. Needs an API key (PROOFREAD_API_KEY, or one from sign_up). " +
    "Plans: payg = pay as you go (no monthly fee; per check and per deep-checked citation), solo = monthly, firm = monthly with more keys; current prices at https://proofread.law/pricing. " +
    "Give the link to the account owner to open in a browser; the plan is live within a minute of payment. No charge happens until the owner pays. " +
    "An account that already has a subscription answers 409 (the owner changes plans in the billing portal at https://proofread.law/account).",
  inputSchema: {
    plan: z.enum(["payg", "solo", "firm"]).default("payg").describe("payg (pay as you go), solo or firm."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ plan }, { client }, extra) {
    if (!client.hasApiKey()) return fail("billing_link needs an API key: set PROOFREAD_API_KEY, or call sign_up first to create an account and key.");
    try {
      const link = await client.checkoutLink(plan, extra.signal);
      const text = [
        `Checkout link for the ${link.plan ?? plan} plan: ${link.checkout_url}`,
        link.note ?? "Open it in a browser or hand it to the account owner. The plan activates within a minute of payment.",
      ].join("\n");
      return ok(text, { plan: link.plan ?? plan, checkout_url: link.checkout_url });
    } catch (err) {
      return fail(err);
    }
  },
});
