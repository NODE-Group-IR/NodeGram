export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/[^/\s]+$/.test(s));
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: readonly string[],
): origin is string {
  if (!origin || allowed.length === 0) {
    return false;
  }
  return allowed.includes(origin);
}

export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
): Record<string, string> {
  if (!isOriginAllowed(origin, allowed)) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function corsEnabled(allowed: readonly string[]): boolean {
  return allowed.length > 0;
}
