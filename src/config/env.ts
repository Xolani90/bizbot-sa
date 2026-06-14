import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  whatsappToken: required('WHATSAPP_TOKEN'),
  whatsappPhoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappVerifyToken: required('WHATSAPP_VERIFY_TOKEN'),
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',

  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  yocoSecretKey: process.env.YOCO_SECRET_KEY ?? '',

  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Africa/Johannesburg',
};
