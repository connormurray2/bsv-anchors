// Protocol
export {
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  type ProofMessageType,
  type ProofMessage,
  type ProofRequest,
  type ProofResponse,
  type ProofPush,
  type ProofAck,
  type ProofError,
  type ProofErrorCode,
  encodeMessage,
  decodeMessage,
  createProofRequest,
  createProofResponse,
  createProofPush,
  createProofAck,
  createProofError,
  generateRequestId,
  generatePushId,
  validateRequest,
} from './protocol.js';

// Handler
export {
  ProofHandler,
  type ProofHandlerConfig,
} from './handler.js';

// Client
export {
  ProofClient,
  type ProofClientConfig,
  type P2PTransport,
  createHttpTransport,
} from './client.js';
