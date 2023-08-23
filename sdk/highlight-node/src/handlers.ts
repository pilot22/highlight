import * as http from 'http'
import { NodeOptions } from '.'
import { H, HIGHLIGHT_REQUEST_HEADER } from './sdk.js'
import type { Attributes } from '@opentelemetry/api'

/** JSDoc */
interface MiddlewareError extends Error {
	status?: number | string
	statusCode?: number | string
	status_code?: number | string
	output?: {
		statusCode?: number | string
	}
}

function processErrorImpl(
	options: NodeOptions,
	req: { headers?: http.IncomingHttpHeaders },
	error: Error,
	metadata?: Attributes,
): void {
	let secureSessionId: string | undefined
	let requestId: string | undefined
	if (req.headers && req.headers[HIGHLIGHT_REQUEST_HEADER]) {
		;[secureSessionId, requestId] =
			`${req.headers[HIGHLIGHT_REQUEST_HEADER]}`.split('/')
	}
	H._debug('processError', 'extracted from headers', {
		secureSessionId,
		requestId,
	})

	if (!H.isInitialized()) {
		H.init(options)
		H._debug('initialized H')
	}
	H.consumeError(error, secureSessionId, requestId, metadata)
	H._debug('consumed error', error)
}

/**
 * Express compatible error handler.
 * Exposed as `Handlers.errorHandler`.
 * `metadata` accepts structured tags that should be attached to every error.
 */
export function errorHandler(
	options: NodeOptions,
	metadata?: Attributes,
): (
	error: MiddlewareError,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	next: (error: MiddlewareError) => void,
) => void {
	H._debug('setting up error handler')
	return (
		error: MiddlewareError,
		req: http.IncomingMessage,
		res: http.ServerResponse,
		next: (error: MiddlewareError) => void,
	) => {
		H._debug('handling request')
		try {
			processErrorImpl(options, req, error, metadata)
		} finally {
			next(error)
		}
	}
}

// this code was assisted by https://github.com/getsentry/sentry-javascript/blob/master/packages/node/src/handlers.ts

/**
 * A TRPC compatible error handler for logging errors to Highlight.
 * `metadata` accepts structured tags that should be attached to every error.
 */
export async function trpcOnError(
	{
		error,
		req,
	}: { error: Error; req: { headers?: http.IncomingHttpHeaders } },
	options: NodeOptions,
	metadata?: Attributes,
): Promise<void> {
	try {
		if (!H.isInitialized()) {
			H.init(options)
		}
		processErrorImpl(options, req, error, metadata)
		await H.flush()
	} catch (e) {
		console.warn('highlight-node trpcOnError error:', e)
	}
}

declare type Headers = { [name: string]: string | undefined }

const makeHandler = (
	origHandler: (...args: any) => any,
	options: NodeOptions,
	metadata: Attributes | undefined,
	headersExtractor: (...args: any) => Headers | undefined,
) => {
	return async (...args: any) => {
		try {
			return await origHandler(...args)
		} catch (e) {
			try {
				if (e instanceof Error) {
					if (!H.isInitialized()) {
						H.init(options)
					}
					processErrorImpl(
						options,
						{ headers: headersExtractor(args) },
						e,
						metadata,
					)
					await H.flush()
				}
			} catch (e) {
				console.warn('highlight-node serverlessFunction error:', e)
			}

			// Rethrow the error here to allow any other error handling to happen
			throw e
		}
	}
}

/**
 * A wrapper for logging errors to Highlight for Firebase HTTP functions.
 * `metadata` accepts structured tags that should be attached to every error.
 */
declare type FirebaseHttpFunctionHandler = (
	req: any,
	resp: any,
) => void | Promise<void>
export function firebaseHttpFunctionHandler(
	origHandler: FirebaseHttpFunctionHandler,
	options: NodeOptions,
	metadata?: Attributes,
): FirebaseHttpFunctionHandler {
	return makeHandler(
		origHandler,
		options,
		metadata,
		(req, res) => req.headers,
	)
}

/**
 * A wrapper for logging errors to Highlight for Firebase callable functions.
 * `metadata` accepts structured tags that should be attached to every error.
 */
declare type FirebaseCallableFunctionHandler = (data: any, context: any) => any
export function firebaseCallableFunctionHandler(
	origHandler: FirebaseCallableFunctionHandler,
	options: NodeOptions,
	metadata?: Attributes,
): FirebaseCallableFunctionHandler {
	return makeHandler(
		origHandler,
		options,
		metadata,
		(data, ctx) => ctx.rawRequest,
	)
}

/**
 * A wrapper for logging errors to Highlight for AWS Lambda and other serverless functions.
 * `metadata` accepts structured tags that should be attached to every error.
 */
declare type ServerlessCallableFunctionHandler = (event?: any) => any
export function serverlessFunction(
	origHandler: ServerlessCallableFunctionHandler,
	options: NodeOptions,
	metadata?: Attributes,
): ServerlessCallableFunctionHandler {
	return makeHandler(
		origHandler,
		options,
		metadata,
		(event) => event?.headers,
	)
}
