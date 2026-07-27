// /apps/mobile/src/lib/embeddings.ts

// Local multilingual E5 sentence embeddings via ONNX Runtime React Native.
// Corpus texts are embedded as passages and user questions as queries.
// The tokenizer and quantised embedding model are bundled with the app.

import { Asset } from "expo-asset";
import * as ort from "onnxruntime-react-native";

const PAD_TOKEN_ID = BigInt(1);
const EMBEDDING_DIMENSION = 384;

type E5Mode = "query" | "passage";

type NumericTensorData =
  | readonly number[]
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

type BigIntTensorData =
  | readonly bigint[]
  | BigInt64Array
  | BigUint64Array;

let tokenizerSession: ort.InferenceSession | null = null;
let embeddingSession: ort.InferenceSession | null = null;
let loading: Promise<void> | null = null;

/** Resolve a bundled ONNX asset to a local file URI. */
async function loadModelAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);

  if (!asset.localUri) {
    await asset.downloadAsync();
  }

  if (!asset.localUri) {
    throw new Error(`Unable to resolve bundled ONNX asset: ${asset.name}`);
  }

  return asset.localUri;
}

/** Load the tokenizer and E5 embedding model exactly once. */
async function ensureModels(): Promise<void> {
  if (tokenizerSession && embeddingSession) {
    return;
  }

  if (loading) {
    return loading;
  }

  loading = (async () => {
    const [tokenizerUri, embeddingModelUri] = await Promise.all([
      loadModelAsset(require("../../assets/models/e5/tokenizer.onnx")),
      loadModelAsset(require("../../assets/models/e5/model_int8.onnx")),
    ]);

    const [loadedTokenizer, loadedEmbeddingModel] = await Promise.all([
      ort.InferenceSession.create(tokenizerUri),
      ort.InferenceSession.create(embeddingModelUri),
    ]);

    tokenizerSession = loadedTokenizer;
    embeddingSession = loadedEmbeddingModel;
  })();

  try {
    await loading;
  } catch (error) {
    tokenizerSession = null;
    embeddingSession = null;
    loading = null;
    throw error;
  }
}

/** Add the prefix expected by multilingual E5. */
function prefixText(text: string, mode: E5Mode): string {
  return `${mode}: ${text.trim()}`;
}

/** Convert ordinary numeric tensor data to JavaScript numbers. */
function numericTensorDataToNumbers(
  data: NumericTensorData
): number[] {
  const result = new Array<number>(data.length);

  for (let index = 0; index < data.length; index++) {
    result[index] = Number(data[index]);
  }

  return result;
}

/** Convert int64 tensor data to JavaScript numbers. */
function bigintTensorDataToNumbers(
  data: BigIntTensorData
): number[] {
  const result = new Array<number>(data.length);

  for (let index = 0; index < data.length; index++) {
    result[index] = Number(data[index]);
  }

  return result;
}

/**
 * Tokenise a text batch and construct padded model inputs.
 *
 * The tokenizer returns:
 * - tokens_cast: flattened token IDs
 * - instance_indices: cumulative offsets for each input string
 * - token_indices: character positions, not required by the E5 model
 */
async function tokenise(
  texts: string[]
): Promise<{
  inputIds: ort.Tensor;
  attentionMask: ort.Tensor;
}> {
  if (!tokenizerSession) {
    throw new Error("E5 tokenizer session is not ready");
  }

  const inputTensor = new ort.Tensor(
    "string",
    texts,
    [texts.length]
  );

  const outputs = await tokenizerSession.run({
    inputs: inputTensor,
  });

  const tokensTensor = outputs.tokens_cast;
  const offsetsTensor = outputs.instance_indices;

  if (!tokensTensor || !offsetsTensor) {
    throw new Error(
      "Tokenizer output is missing tokens_cast or instance_indices"
    );
  }

  const flattenedTokens = bigintTensorDataToNumbers(
    tokensTensor.data as BigIntTensorData
  );

  const offsets = bigintTensorDataToNumbers(
    offsetsTensor.data as BigIntTensorData
  );

  if (offsets.length !== texts.length + 1) {
    throw new Error(
      `Unexpected tokenizer offsets: expected ${
        texts.length + 1
      }, received ${offsets.length}`
    );
  }

  const sequences: number[][] = [];

  for (let index = 0; index < texts.length; index++) {
    const start = offsets[index];
    const end = offsets[index + 1];

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > flattenedTokens.length
    ) {
      throw new Error(
        `Invalid tokenizer offsets for sequence ${index}: ${start}:${end}`
      );
    }

    sequences.push(flattenedTokens.slice(start, end));
  }

  const sequenceLength = Math.max(
    1,
    ...sequences.map((sequence) => sequence.length)
  );

  const tensorSize = texts.length * sequenceLength;
  const inputIdsData = new BigInt64Array(tensorSize);
  const attentionMaskData = new BigInt64Array(tensorSize);

  inputIdsData.fill(PAD_TOKEN_ID);

  for (let row = 0; row < sequences.length; row++) {
    const sequence = sequences[row];

    for (let column = 0; column < sequence.length; column++) {
      const flatIndex = row * sequenceLength + column;

      inputIdsData[flatIndex] = BigInt(sequence[column]);
      attentionMaskData[flatIndex] = BigInt(1);
    }
  }

  return {
    inputIds: new ort.Tensor(
      "int64",
      inputIdsData,
      [texts.length, sequenceLength]
    ),
    attentionMask: new ort.Tensor(
      "int64",
      attentionMaskData,
      [texts.length, sequenceLength]
    ),
  };
}

/** Run multilingual E5 for a batch of queries or passages. */
async function embed(
  texts: string[],
  mode: E5Mode
): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  await ensureModels();

  if (!embeddingSession) {
    throw new Error("E5 embedding session is not ready");
  }

  const prefixedTexts = texts.map((text) =>
    prefixText(text, mode)
  );

  const { inputIds, attentionMask } = await tokenise(
    prefixedTexts
  );

  const outputs = await embeddingSession.run({
    input_ids: inputIds,
    attention_mask: attentionMask,
  });

  const sentenceEmbedding = outputs.sentence_embedding;

  if (!sentenceEmbedding) {
    throw new Error(
      "E5 output is missing sentence_embedding"
    );
  }

  const shape = sentenceEmbedding.dims;

  if (
    shape.length !== 2 ||
    shape[0] !== texts.length ||
    shape[1] !== EMBEDDING_DIMENSION
  ) {
    throw new Error(
      `Unexpected E5 sentence_embedding shape: [${shape.join(", ")}]`
    );
  }

  const flatData = numericTensorDataToNumbers(
    sentenceEmbedding.data as NumericTensorData
  );

  const embeddings: number[][] = new Array(texts.length);

  for (let row = 0; row < texts.length; row++) {
    const start = row * EMBEDDING_DIMENSION;
    const end = start + EMBEDDING_DIMENSION;

    embeddings[row] = flatData.slice(start, end);
  }

  return embeddings;
}

/** Embed one user question using the multilingual E5 query prefix. */
export async function embedOne(
  text: string
): Promise<number[]> {
  const [embedding] = await embed([text], "query");

  return embedding;
}

/** Embed corpus chunks using the multilingual E5 passage prefix. */
export async function embedMany(
  texts: string[]
): Promise<number[][]> {
  return embed(texts, "passage");
}

/** Clear loaded sessions so tests can start from a clean state. */
export function _resetEmbeddingsForTests(): void {
  tokenizerSession = null;
  embeddingSession = null;
  loading = null;
}