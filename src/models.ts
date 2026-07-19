/**
 * Single source of truth for models.
 *
 * The proxy never needs a code change for a new Claude release. Clients either:
 *   - ride the latest model in a family via its alias
 *     (`opus`/`fable`/`sonnet`/`haiku`), which the CLI resolves to the newest
 *     version in that family, or
 *   - pin an exact version by full ID (e.g. `claude-opus-4-8`), passed straight
 *     through to the CLI.
 *
 * So `/v1/models` advertises the evergreen family aliases by default.
 * To additionally advertise specific pinned IDs (e.g. to populate a UI model
 * picker), set `CLAUDE_PROXY_MODELS` to a comma-separated list:
 *   CLAUDE_PROXY_MODELS=claude-opus-4-8,claude-sonnet-4-6
 *
 * All model resolution (alias vs pinned, provider-prefix stripping, family
 * detection) lives here; `adapter/openai-to-cli.ts` re-exports `extractModel`
 * for backwards compatibility.
 */

/** A value accepted by `claude --model`: a family alias or a full version ID. */
export type ClaudeModel = string;

export const MODEL_FAMILIES = ["opus", "fable", "sonnet", "haiku"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** Default model when a request omits `model`: the evergreen latest Opus. */
export const DEFAULT_MODEL_ALIAS: ModelFamily = "opus";

/** Prefixes some gateways prepend; stripped before resolving a model. */
export const PROVIDER_PREFIXES = [
  "anthropic/",
  "claude-max/",
  "claude-code-cli/",
];

export interface ProxyModel {
  id: string;
  /** Family this model belongs to (drives the reasoning flag and pricing). */
  family: ModelFamily;
}

// A full, pinnable version ID carries a family + at least major-minor, e.g.
// claude-opus-4-8 or claude-sonnet-4-5-20250929. Fable versions with a single
// number (claude-fable-5) are also full IDs — there is no major-only fable name.
const CLAUDE_FULL_ID_RE = /^claude-((opus|sonnet|haiku)-\d+-\d+|fable-\d+)/i;
// Looser "is this a Claude model at all" check (family + a number), used to
// decide whether GET /v1/models/{id} should resolve an unadvertised ID.
const CLAUDE_ANY_ID_RE = /^claude-(opus|fable|sonnet|haiku)-\d/i;

/** Remove a known provider prefix (`anthropic/…`, etc.) if present. */
export function stripProviderPrefix(model: string): string {
  let m = (model || "").trim();
  for (const prefix of PROVIDER_PREFIXES) {
    if (m.startsWith(prefix)) {
      m = m.slice(prefix.length);
      break;
    }
  }
  return m;
}

/** Detect which family an alias or ID belongs to. Defaults to opus. */
export function familyOf(model: string): ModelFamily {
  const lower = stripProviderPrefix(model).toLowerCase();
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("fable")) return "fable";
  return "opus";
}

/**
 * Resolve a requested model string to a value for `claude --model`.
 *
 *   - A full version ID (family + major-minor, e.g. `claude-opus-4-8`) is passed
 *     through verbatim so the CLI runs that exact version. Provider prefixes are
 *     stripped first.
 *   - Anything else maps to the family alias (`opus`/`fable`/`sonnet`/`haiku`),
 *     which the CLI resolves to the latest model in that family. This covers bare aliases,
 *     major-only names like `claude-opus-4` (not a valid full ID), and unknown
 *     names (which default to opus).
 */
export function resolveModelArg(model: string): ClaudeModel {
  const m = stripProviderPrefix(model);
  if (CLAUDE_FULL_ID_RE.test(m)) return m; // pin this exact version
  return familyOf(m); // otherwise the family's latest, via its alias
}

/** Extra advertised IDs from CLAUDE_PROXY_MODELS (trimmed, non-empty). */
function extraModelIds(): string[] {
  const env = process.env.CLAUDE_PROXY_MODELS;
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The models the proxy advertises: the evergreen family aliases first,
 * then any pinned IDs from CLAUDE_PROXY_MODELS (deduped).
 */
export function listModels(): ProxyModel[] {
  const seen = new Set<string>();
  const models: ProxyModel[] = [];

  for (const family of MODEL_FAMILIES) {
    seen.add(family);
    models.push({ id: family, family });
  }
  for (const id of extraModelIds()) {
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, family: familyOf(id) });
  }
  return models;
}

/** True when `id` is a family alias or a recognizable Claude version ID. */
export function isKnownModelId(id: string): boolean {
  const m = stripProviderPrefix(id);
  const lower = m.toLowerCase();
  if ((MODEL_FAMILIES as readonly string[]).includes(lower)) return true;
  return CLAUDE_ANY_ID_RE.test(m);
}

/**
 * Resolve a single model for GET /v1/models/{id}. Returns an advertised model,
 * or a synthesized entry for any recognizable Claude ID/alias, or undefined for
 * clearly-foreign names (e.g. `gpt-4o`) so the route can 404.
 */
export function getModel(id: string): ProxyModel | undefined {
  const advertised = listModels().find((m) => m.id === id);
  if (advertised) return advertised;
  if (isKnownModelId(id)) return { id, family: familyOf(id) };
  return undefined;
}
