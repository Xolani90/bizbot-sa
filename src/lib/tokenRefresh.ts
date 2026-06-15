/**
 * Token health check — logs a warning on startup if the WhatsApp token
 * looks like a temporary one (they start with "EAASE" and expire in 24h).
 * 
 * To fix permanently: create a System User token in Meta Business Manager:
 * business.facebook.com → Settings → System Users → Add → generate token
 * with whatsapp_business_messaging + whatsapp_business_management scopes.
 * System User tokens never expire.
 */
export function warnIfTemporaryToken(token: string): void {
  if (token.startsWith('EAASE') || token.startsWith('EAA')) {
    console.warn(
      '[token] ⚠️  WARNING: WHATSAPP_TOKEN looks like a temporary user token (expires in 24h).\n' +
      '[token]    Create a non-expiring System User token in Meta Business Manager:\n' +
      '[token]    business.facebook.com → Settings → System Users → Add → Generate token\n' +
      '[token]    Scopes needed: whatsapp_business_messaging, whatsapp_business_management'
    );
  } else {
    console.log('[token] ✅ WhatsApp token looks like a System User token (non-expiring).');
  }
}
