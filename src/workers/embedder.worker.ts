/// <reference lib="webworker" />

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

declare const self: DedicatedWorkerGlobalScope;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
      progress_callback: (progress: unknown) => {
        self.postMessage({ type: "progress", progress });
      },
    });
  }
  return pipelinePromise;
}

async function embedOne(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

type IncomingMessage =
  | { id: string; type: "preload" }
  | { id: string; type: "embed"; text: string }
  | { id: string; type: "embed-batch"; texts: string[] };

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "preload": {
        await getPipeline();
        self.postMessage({ id: message.id, ready: true });
        return;
      }
      case "embed": {
        const embedding = await embedOne(message.text);
        self.postMessage({ id: message.id, embedding });
        return;
      }
      case "embed-batch": {
        const embeddings: number[][] = [];
        for (const text of message.texts) {
          embeddings.push(await embedOne(text));
        }
        self.postMessage({ id: message.id, embeddings });
        return;
      }
    }
  } catch (err) {
    self.postMessage({
      id: message.id,
      error: err instanceof Error ? err.message : "Embedding failed.",
    });
  }
};
