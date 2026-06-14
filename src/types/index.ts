export type BusinessType = 'salon' | 'barber' | 'plumber' | 'mechanic' | 'tutor' | 'other';

export type SubscriptionTier = 'free' | 'starter' | 'pro';

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Business {
  id: string;
  whatsapp_number: string;
  name: string | null;
  type: BusinessType | null;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  waba_phone_id: string | null;
  yoco_merchant_id: string | null;
  timezone: string;
  onboarding_status: OnboardingStatus;
  onboarding_step: string;
  onboarding_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConversationState {
  id: string;
  business_id: string | null;
  whatsapp_number: string;
  flow: string;
  step: string;
  context: Record<string, unknown>;
  updated_at: string;
}

/** Normalised representation of an inbound WhatsApp Cloud API message. */
export interface InboundMessage {
  /** Sender's WhatsApp number, e.g. "27821234567" */
  from: string;
  /** WhatsApp message id */
  id: string;
  timestamp: string;
  /** 'text', 'interactive', 'audio', 'image', etc */
  type: string;
  /** Plain text body, present when type === 'text' */
  text?: string;
  /** Raw WhatsApp message object, for logging/debugging */
  raw: Record<string, unknown>;
}

export type IntentLabel =
  | 'booking_request'
  | 'quote_command'
  | 'invoice_command'
  | 'payment_record'
  | 'expense_log'
  | 'marketing_request'
  | 'report_request'
  | 'general_query';

export interface IntentResult {
  intent: IntentLabel;
  confidence: number;
  entities: Record<string, unknown>;
}
