/**
 * Multi-provider AI client with automatic fallback:
 *   Anthropic Claude → OpenAI GPT-4o → Google Gemini
 *
 * Usage: import { chat } from './providers.js'
 * The orchestrator uses createMessages() to stay provider-agnostic.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    model: 'claude-opus-4-8',
    available: () => !!process.env.ANTHROPIC_API_KEY,
  },
  openai: {
    name: 'OpenAI GPT-4o',
    model: 'gpt-4o',
    available: () => !!process.env.OPENAI_API_KEY,
  },
  gemini: {
    name: 'Google Gemini',
    model: 'gemini-1.5-pro',
    available: () => !!process.env.GEMINI_API_KEY,
  },
};

// ── Anthropic ──────────────────────────────────────────────────────────────────
async function callAnthropic(system, messages, tools = [], maxTokens = 8192) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.messages.create({
    model: PROVIDERS.anthropic.model,
    max_tokens: maxTokens,
    system,
    tools: tools.length ? tools : undefined,
    messages,
  });
}

// ── OpenAI ─────────────────────────────────────────────────────────────────────
async function callOpenAI(system, messages, tools = [], maxTokens = 8192) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Convert Anthropic tool format → OpenAI tool format
  const oaiTools = tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // Convert Anthropic message format → OpenAI format
  const oaiMessages = [
    { role: 'system', content: system },
    ...messages.map(m => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      // Handle tool results
      if (Array.isArray(m.content) && m.content[0]?.type === 'tool_result') {
        return m.content.map(tr => ({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        }));
      }
      // Handle assistant tool_use blocks
      if (Array.isArray(m.content)) {
        const text = m.content.find(b => b.type === 'text')?.text ?? '';
        const toolCalls = m.content.filter(b => b.type === 'tool_use').map(b => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
        return { role: 'assistant', content: text || null, tool_calls: toolCalls.length ? toolCalls : undefined };
      }
      return { role: m.role, content: m.content };
    }).flat(),
  ];

  const response = await client.chat.completions.create({
    model: PROVIDERS.openai.model,
    max_tokens: maxTokens,
    messages: oaiMessages,
    tools: oaiTools.length ? oaiTools : undefined,
    tool_choice: oaiTools.length ? 'auto' : undefined,
  });

  // Normalize to Anthropic-like response shape
  const choice = response.choices[0];
  const content = [];
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
  (choice.message.tool_calls ?? []).forEach(tc => content.push({
    type: 'tool_use',
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments ?? '{}'),
  }));

  return {
    content,
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    provider: 'openai',
  };
}

// ── Google Gemini ──────────────────────────────────────────────────────────────
async function callGemini(system, messages, tools = [], maxTokens = 8192) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Gemini tool format
  const geminiTools = tools.length ? [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  }] : undefined;

  const model = genAI.getGenerativeModel({
    model: PROVIDERS.gemini.model,
    systemInstruction: system,
    tools: geminiTools,
    generationConfig: { maxOutputTokens: maxTokens },
  });

  // Convert messages to Gemini format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: typeof m.content === 'string'
      ? [{ text: m.content }]
      : (m.content ?? []).map(b => {
          if (b.type === 'text') return { text: b.text };
          if (b.type === 'tool_result') return { text: b.content };
          if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input } };
          return { text: JSON.stringify(b) };
        }),
  }));

  const lastMsg = messages.at(-1);
  const lastParts = typeof lastMsg?.content === 'string'
    ? [{ text: lastMsg.content }]
    : (lastMsg?.content ?? []).map(b => b.type === 'text' ? { text: b.text } : { text: b.content ?? '' });

  const chat = model.startChat({ history });
  const response = await chat.sendMessage(lastParts);
  const result = response.response;

  const content = [];
  const text = result.text?.();
  if (text) content.push({ type: 'text', text });

  const fnCalls = result.functionCalls?.() ?? [];
  fnCalls.forEach(fc => content.push({
    type: 'tool_use',
    id: `gemini-${Date.now()}-${fc.name}`,
    name: fc.name,
    input: fc.args,
  }));

  return {
    content,
    stop_reason: fnCalls.length ? 'tool_use' : 'end_turn',
    provider: 'gemini',
  };
}

// ── Router with fallback ───────────────────────────────────────────────────────
const RETRYABLE_ERRORS = ['overloaded', 'rate_limit', 'quota', '529', '429', '503'];

function isRetryable(err) {
  const msg = (err?.message ?? err?.status ?? '').toString().toLowerCase();
  return RETRYABLE_ERRORS.some(e => msg.includes(e));
}

export async function callAI(system, messages, tools = [], maxTokens = 8192) {
  const order = ['anthropic', 'openai', 'gemini'].filter(p => PROVIDERS[p].available());

  for (const provider of order) {
    try {
      console.error(`[AI] Using ${PROVIDERS[provider].name}`);
      if (provider === 'anthropic') return await callAnthropic(system, messages, tools, maxTokens);
      if (provider === 'openai')    return await callOpenAI(system, messages, tools, maxTokens);
      if (provider === 'gemini')    return await callGemini(system, messages, tools, maxTokens);
    } catch (err) {
      const retryable = isRetryable(err);
      console.error(`[AI] ${PROVIDERS[provider].name} failed: ${err.message}${retryable ? ' → trying next provider' : ''}`);
      if (!retryable) throw err; // non-retryable (bad key, etc.) — don't try others
    }
  }
  throw new Error('All AI providers exhausted. Check API keys in .env');
}

export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, model: p.model, active: p.available(),
  }));
}
