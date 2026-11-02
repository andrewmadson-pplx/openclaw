// Perplexity Agent API live tests prove authentication, Responses turns, and tool replay.
import {
  streamSimple,
  type AssistantMessage,
  type Context,
  type Model,
} from "openclaw/plugin-sdk/llm";
import { ensureGlobalUndiciEnvProxyDispatcher } from "openclaw/plugin-sdk/runtime-env";
import { extractNonEmptyAssistantText, isLiveTestEnabled } from "openclaw/plugin-sdk/test-live";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
  makeTextToolResult,
  makeUserMessage,
} from "../test-support/message-fixtures.test-support.js";
import { buildPerplexityAgentProvider } from "./provider-catalog.js";
import { normalizePerplexityToolSchemas } from "./tool-schemas.js";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY?.trim() ?? "";
const LIVE_MODEL_IDS = buildPerplexityAgentProvider().models.map((model) => model.id);
// This bounds the live request; it is not an advertised model limit.
const LIVE_TEST_MAX_OUTPUT_TOKENS = 2_000;
const LIVE =
  isLiveTestEnabled(["PERPLEXITY_LIVE_TEST", "MODEL_API_LIVE_TEST"]) &&
  PERPLEXITY_API_KEY.length > 0;
if (LIVE) {
  ensureGlobalUndiciEnvProxyDispatcher();
}
const describeLive = LIVE ? describe : describe.skip;

function resolveLiveModel(modelId: string): Model<"openai-responses"> {
  const provider = buildPerplexityAgentProvider();
  const catalogModel = provider.models.find((entry) => entry.id === modelId);
  if (!catalogModel) {
    throw new Error(`Perplexity catalog does not include ${modelId}`);
  }
  return {
    provider: "perplexity-agent",
    baseUrl: provider.baseUrl,
    ...catalogModel,
    api: "openai-responses",
  } as Model<"openai-responses">;
}

async function expectLiveCompletion(params: {
  modelId: string;
  context: Context;
  expectedText?: string | RegExp;
  expectedStopReason?: "stop" | "toolUse";
}): Promise<{ result: AssistantMessage; payload: Record<string, unknown> }> {
  const { modelId, context, expectedText, expectedStopReason = "stop" } = params;
  let capturedPayload: Record<string, unknown> | undefined;
  let responseStatus: number | undefined;
  const stream = await streamSimple(resolveLiveModel(modelId), context, {
    apiKey: PERPLEXITY_API_KEY,
    maxTokens: LIVE_TEST_MAX_OUTPUT_TOKENS,
    onPayload: (payload) => {
      capturedPayload = payload as Record<string, unknown>;
    },
    onResponse: (response) => {
      responseStatus = response.status;
    },
  });
  let textDeltas = 0;
  for await (const event of stream) {
    if (event.type === "text_delta") {
      textDeltas += 1;
    }
  }
  const result = await stream.result();
  if (result.stopReason === "error") {
    throw new Error(result.errorMessage || "Perplexity returned an error");
  }
  expect(responseStatus).toBe(200);
  expect(result.stopReason).toBe(expectedStopReason);
  expect(capturedPayload?.model).toBe(modelId);
  expect(capturedPayload?.max_output_tokens).toBe(LIVE_TEST_MAX_OUTPUT_TOKENS);
  const assistantText = extractNonEmptyAssistantText(result.content).trim();
  if (typeof expectedText === "string") {
    expect(assistantText).toBe(expectedText);
  } else if (expectedText !== undefined) {
    expect(assistantText).toMatch(expectedText);
  }
  console.info(
    `[perplexity-agent:live] ${JSON.stringify({
      requestedModel: modelId,
      effectiveModel: result.responseModel ?? result.model,
      httpStatus: responseStatus,
      stopReason: result.stopReason,
      textDeltas,
      usage: result.usage,
    })}`,
  );
  return { result, payload: capturedPayload! };
}

describeLive("perplexity agent provider live", () => {
  it.each(LIVE_MODEL_IDS)(
    "completes a %s Responses API turn",
    async (modelId) => {
      await expectLiveCompletion({
        modelId,
        context: { messages: [makeUserMessage("Reply with exactly: PATCH_OK", Date.now())] },
        expectedText: /PATCH_OK/i,
      });
    },
    120_000,
  );

  it.each(LIVE_MODEL_IDS)(
    "replays a %s tool-call round trip",
    async (modelId) => {
      const context: Context = {
        messages: [
          makeUserMessage(
            "Call get_probe_token exactly once with label set to alpha. After the tool returns, reply with only its token.",
            Date.now(),
          ),
        ],
        tools: normalizePerplexityToolSchemas([
          {
            name: "get_probe_token",
            description: "Returns the token required for the final answer.",
            parameters: Type.Object({
              label: Type.String(),
              metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
            }),
          },
        ]),
      };
      const first = await expectLiveCompletion({ modelId, context, expectedStopReason: "toolUse" });
      const calls = first.result.content.filter((block) => block.type === "toolCall");
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.name).toBe("get_probe_token");
      expect(call.arguments).toMatchObject({ label: "alpha" });
      context.messages.push(
        first.result,
        makeTextToolResult(call.id, call.name, "PPLX_REPLAY_OK_31C7", false, Date.now()),
      );
      const second = await expectLiveCompletion({
        modelId,
        context,
        expectedText: /PPLX_REPLAY_OK_31C7/,
      });
      expect(second.payload.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "function_call_output", output: "PPLX_REPLAY_OK_31C7" }),
        ]),
      );
    },
    180_000,
  );
});
