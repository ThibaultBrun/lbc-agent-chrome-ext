// LlmRouter : abstraction backend (Ollama/WebLLM/Nano) avec API json/text uniforme.

import { ollamaChat } from "./llm.js";

export function safeParseJson(s) {
  if (!s) return null;
  const trimmed = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(trimmed); } catch { /* try harder */ }
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fail */ }
  }
  return null;
}

export class LlmRouter {
  constructor({ backend, nanoBridge, webllmBridge, onProgress }) {
    this.backend = backend;
    this.nanoBridge = nanoBridge;
    this.webllmBridge = webllmBridge;
    this.onProgress = onProgress;
  }

  async json({ system, prompt, schema, model, temperature = 0, timeout = 60000 }) {
    if (this.backend.kind === "ollama") {
      const out = await ollamaChat({
        url: this.backend.url,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        format: schema,
        temperature,
        timeout,
      });
      return safeParseJson(out);
    }
    if (this.backend.kind === "webllm" && this.webllmBridge) {
      const out = await this.webllmBridge({
        prompt, system, schema,
        model: this.backend.model,
        onProgress: this.onProgress,
      });
      return safeParseJson(out);
    }
    if (this.backend.kind === "nano" && this.nanoBridge) {
      const out = await this.nanoBridge({ prompt, system, schema, onProgress: this.onProgress });
      return safeParseJson(out);
    }
    throw new Error(`No LLM backend available (kind=${this.backend.kind})`);
  }

  async text({ system, prompt, model, temperature = 0.2, timeout = 90000, onChunk }) {
    if (this.backend.kind === "ollama") {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ];
      if (onChunk) {
        const { ollamaChatStream } = await import("./llm.js");
        return ollamaChatStream({ url: this.backend.url, model, messages, temperature, onChunk });
      }
      return ollamaChat({ url: this.backend.url, model, messages, temperature, timeout });
    }
    if (this.backend.kind === "webllm" && this.webllmBridge) {
      return this.webllmBridge({
        prompt, system,
        model: this.backend.model,
        stream: !!onChunk, onChunk,
        onProgress: this.onProgress,
      });
    }
    if (this.backend.kind === "nano" && this.nanoBridge) {
      return this.nanoBridge({ prompt, system, stream: !!onChunk, onChunk, onProgress: this.onProgress });
    }
    throw new Error(`No LLM backend available (kind=${this.backend.kind})`);
  }
}
