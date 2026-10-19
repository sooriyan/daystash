/**
 * Resolves the authenticated user ID from the incoming Next.js Request.
 * Supports:
 * 1. `x-user-id` header (set by reverse proxies, API Gateways, or mobile clients)
 * 2. `Authorization: Bearer <token>` (JWT or auth token format)
 */
export function extractAuthUserId(request: Request): string | null {
  // 1. Gateway / custom user header
  const headerUserId = request.headers.get('x-user-id');
  if (headerUserId && headerUserId.trim().length > 0) {
    return headerUserId.trim();
  }

  // 2. Authorization Bearer Token
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (!token) return null;

    // Handle JWT payload decode if token contains dots (header.payload.signature)
    if (token.includes('.')) {
      try {
        const parts = token.split('.');
        if (parts.length >= 2 && parts[1]) {
          const base64Url = parts[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          const parsed = JSON.parse(jsonPayload) as { sub?: string; userId?: string; id?: string };
          const sub = parsed.sub || parsed.userId || parsed.id;
          if (sub) return sub;
        }
      } catch {
        // Fall back to treating token as raw ID if JWT decoding fails
      }
    }

    // Direct token string fallback
    return token;
  }

  return null;
}
