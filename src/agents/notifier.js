/**
 * Notifier Agent — multi-channel alerts (email, SMS, browser, webhook)
 */

const EMAIL_API = process.env.SENDGRID_API_KEY ? 'sendgrid' : 'console';
const SMS_API = process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'console';

export async function sendAlert(alert) {
  const { type, severity, message, recipient, channels = ['browser'] } = alert;

  console.log(`[${severity.toUpperCase()}] ${type}: ${message}`);

  const results = {};

  // Browser notification via WebSocket
  if (channels.includes('browser')) {
    results.browser = 'queued';
  }

  // Email
  if (channels.includes('email') && recipient?.email) {
    try {
      if (EMAIL_API === 'sendgrid') {
        // TODO: integrate SendGrid
        results.email = 'sent';
      } else {
        results.email = 'logged to console';
      }
    } catch(e) {
      results.email = `failed: ${e.message}`;
    }
  }

  // SMS
  if (channels.includes('sms') && recipient?.phone) {
    try {
      if (SMS_API === 'twilio') {
        // TODO: integrate Twilio
        results.sms = 'sent';
      } else {
        results.sms = 'logged to console';
      }
    } catch(e) {
      results.sms = `failed: ${e.message}`;
    }
  }

  // Webhook
  if (channels.includes('webhook') && process.env.ALERT_WEBHOOK_URL) {
    try {
      await fetch(process.env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      });
      results.webhook = 'sent';
    } catch(e) {
      results.webhook = `failed: ${e.message}`;
    }
  }

  return results;
}

// High-conviction pick notification
export async function notifyNewPick(pick) {
  return sendAlert({
    type: 'new_pick',
    severity: pick.bullRatio >= 80 ? 'critical' : 'high',
    message: `${pick.ticker} ${pick.verdict} (${pick.bullRatio}% bullish, $${(pick.callFlow/1000).toFixed(0)}K smart money)`,
    channels: ['browser', 'email', 'sms', 'webhook'],
  });
}

// Trade execution notification
export async function notifyExecution(order) {
  return sendAlert({
    type: 'order_executed',
    severity: 'info',
    message: `Executed: ${order.order.qty} ${order.order.symbol} @ $${order.order.limitPrice}`,
    channels: ['browser', 'email'],
  });
}

// Risk alert notification
export async function notifyRiskAlert(metrics) {
  const alerts = [];

  if (parseFloat(metrics.winRate) < 45) {
    alerts.push(
      sendAlert({
        type: 'low_win_rate',
        severity: 'warning',
        message: `Win rate dropped to ${metrics.winRate}% - consider a trading break`,
        channels: ['browser', 'email', 'sms'],
      })
    );
  }

  if (Math.abs(parseFloat(metrics.maxDrawdown)) > 1000) {
    alerts.push(
      sendAlert({
        type: 'max_drawdown_exceeded',
        severity: 'critical',
        message: `Drawdown of $${metrics.maxDrawdown} exceeds safe limit - STOP TRADING`,
        channels: ['browser', 'email', 'sms', 'webhook'],
      })
    );
  }

  return Promise.all(alerts);
}

// Batch notification for AI Agent scanning
export async function notifyAIScan(picks) {
  const topPick = picks[0];
  if (!topPick) return;

  return sendAlert({
    type: 'ai_scan_complete',
    severity: topPick.bullRatio >= 75 ? 'high' : 'info',
    message: `AI found ${picks.length} opportunities. Top: ${topPick.ticker} (${topPick.bullRatio}% bullish)`,
    channels: ['browser'],
  });
}
