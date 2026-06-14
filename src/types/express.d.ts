// Augments Express's Request type with `rawBody`, populated by the
// express.json() verify hook in src/server.ts. Needed for verifying the
// X-Hub-Signature-256 header on WhatsApp webhook requests.
declare namespace Express {
  interface Request {
    rawBody: Buffer;
  }
}
