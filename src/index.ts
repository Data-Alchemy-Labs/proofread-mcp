export { createServer, INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { startHttp } from "./http.js";
export { createClient, verifyPath, MAX_BATCH_CITES, type Client, type VerifyOptions } from "./client.js";
export { configFromEnv, DEFAULT_BASE_URL, type Config } from "./config.js";
export { ProofreadError, explain } from "./errors.js";
export { formatReport, formatRowLine, formatRowDetail, TIER_WORD } from "./format.js";
export { formatResolve, formatResolveLine, formatResolveBatch, STATUS_WORD } from "./resolve_format.js";
export { tools } from "./tools/index.js";
export type { Report, Row, Summary, Tier, Coverage, ResolveResult, ResolveBatch, ResolveStatus, ResolveCase, ResolveCoverage } from "./types.js";
