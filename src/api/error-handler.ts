import type { FastifyInstance } from 'fastify';
import { log } from '../log.js';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly details: unknown | undefined = undefined,
  ) {
    super(code);
  }
}

const KNOWN_ERRORS: Record<string, { statusCode: number; code: string }> = {
  idempotency_conflict: { statusCode: 409, code: 'idempotency_conflict' },
  not_found: { statusCode: 404, code: 'not_found' },
  job_not_found: { statusCode: 404, code: 'not_found' },
  invalid_cursor: { statusCode: 400, code: 'invalid_cursor' },
  source_version_conflict: { statusCode: 409, code: 'source_version_conflict' },
  invalid_tenant_transition: { statusCode: 409, code: 'invalid_tenant_transition' },
};

const REQUEST_ERRORS: Record<string, { statusCode: number; code: string }> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { statusCode: 400, code: 'invalid_json' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { statusCode: 400, code: 'invalid_json' },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { statusCode: 400, code: 'invalid_content_length' },
  FST_ERR_CTP_BODY_TOO_LARGE: { statusCode: 413, code: 'payload_too_large' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { statusCode: 415, code: 'unsupported_media_type' },
  FST_ERR_VALIDATION: { statusCode: 400, code: 'invalid_request' },
};

export function installApiErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      error: 'route_not_found',
      request_id: request.id,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      await reply.code(error.statusCode).send({
        error: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
        request_id: request.id,
      });
      return;
    }

    const frameworkCode =
      error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    const requestError = Object.hasOwn(REQUEST_ERRORS, frameworkCode)
      ? REQUEST_ERRORS[frameworkCode]
      : undefined;
    if (requestError) {
      await reply.code(requestError.statusCode).send({
        error: requestError.code,
        request_id: request.id,
      });
      return;
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === 'string' && error
          ? error
          : 'internal_error';
    const known = Object.hasOwn(KNOWN_ERRORS, message) ? KNOWN_ERRORS[message] : undefined;
    if (known) {
      await reply.code(known.statusCode).send({
        error: known.code,
        request_id: request.id,
      });
      return;
    }

    log('error', 'http_request_failed', {
      requestId: request.id,
      error: 'internal_error',
    });
    await reply.code(500).send({
      error: 'internal_error',
      request_id: request.id,
    });
  });
}
