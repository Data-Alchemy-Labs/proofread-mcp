import { z } from "zod";
import { defineTool, fail, ok } from "./tool.js";

export const signUp = defineTool({
  name: "sign_up",
  title: "Create a proofread.law account and API key",
  description:
    "Open a proofread.law account for its owner and get an API key, in one call (POST /agent/signup). Use it when the user wants their own quota " +
    "instead of the anonymous per-IP free tier, or before billing_link. The email must be the account OWNER's real inbox (placeholder domains are rejected); " +
    "the owner receives one confirmation email and nothing else. The key is shown once: this server adopts it for the rest of this session, and the user " +
    "should put it in PROOFREAD_API_KEY in their MCP configuration so it survives a restart. Never send the key anywhere but proofread.law. " +
    "Calling again with the same address while the account is unconfirmed and unpaid rotates the key; a confirmed or paying account answers 409 " +
    "(the owner manages keys at https://proofread.law/account). Free tier per account: 20 checks, 3 deep checks, 1,000 resolves a month; 5 sign-ups an hour per client.",
  inputSchema: {
    email: z.string().email().max(254).describe("The account owner's real email address. Ask the user for it; do not invent one."),
    agent_name: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._-]+$/).describe("A name for this agent or client (1 to 64 characters: letters, digits, spaces, dots, hyphens, underscores), e.g. 'Claude Desktop'."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run({ email, agent_name }, { client }, extra) {
    try {
      const { created, result } = await client.signUp(email, agent_name, extra.signal);
      client.setApiKey(result.api_key);
      const l = result.limits ?? {};
      const limits = [
        l.checks_per_month !== undefined ? `${l.checks_per_month} checks` : undefined,
        l.deep_checks_per_month !== undefined ? `${l.deep_checks_per_month} deep checks` : undefined,
        l.resolves_per_month !== undefined ? `${l.resolves_per_month} resolves` : undefined,
      ].filter(Boolean).join(", ");
      const text = [
        created
          ? `Account created for ${email} (plan: ${result.plan ?? "free"}). The owner has been sent one confirmation email.`
          : `The account for ${email} already existed and was unconfirmed; its previous key was revoked and a new one issued.`,
        `API key (shown once): ${result.api_key}`,
        "This server now uses the key for the rest of this session. Tell the user to store it as PROOFREAD_API_KEY in the MCP server configuration so it survives a restart, and never send it anywhere except proofread.law.",
        limits ? `Free tier per month: ${limits}. When it runs out, billing_link gives the owner a checkout page.` : "When the free tier runs out, billing_link gives the owner a checkout page.",
      ].join("\n");
      return ok(text, { created, email, plan: result.plan ?? "free", key_prefix: result.key_prefix ?? null });
    } catch (err) {
      return fail(err);
    }
  },
});
