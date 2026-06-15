import express, { Request, Response } from 'express';
import { env } from './config/env';
import { whatsappWebhookRouter } from './webhooks/whatsapp.controller';
import { startReminderCron } from './crons/reminders';
import { startWeeklyReportCron } from './crons/weeklyReport';
import { warnIfTemporaryToken } from './lib/tokenRefresh';

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  })
);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'bizbot-sa', time: new Date().toISOString() });
});

app.use('/webhooks/whatsapp', whatsappWebhookRouter);

app.listen(env.port, () => {
  console.log(`BizBot SA backend listening on port ${env.port}`);

  // Warn if using a temporary 24h token
  warnIfTemporaryToken(env.whatsappToken);

  // Start background crons
  startReminderCron();
  startWeeklyReportCron();

  // Keep-alive self-ping every 10 minutes to prevent Render free tier sleeping
  setInterval(() => {
    fetch(`http://localhost:${env.port}/health`).catch(() => {
      // ignore — server may be momentarily busy
    });
  }, 10 * 60 * 1000);
});
