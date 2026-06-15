/**
 * Token health check — logs the token type on startup.
 * System User tokens from Meta Business Manager never expire.
 * User tokens exchanged for long-lived ones last ~60 days.
 */
export function warnIfTemporaryToken(token: string): void {
  // System User tokens start with a different pattern and are much longer
  // All Meta tokens start with EAA — we just log which type we think it is
  if (token.length < 150) {
    console.warn(
      '[token] ⚠️  Short token detected — may be a temporary token. ' +
      'Consider creating a System User token in Meta Business Manager for a non-expiring token.'
    );
  } else {
    console.log('[token] ✅ WhatsApp token loaded (long-lived or system user token).');
  }
}
