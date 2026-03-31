import type { HoaContext, HoaMiddleware } from 'hoa'
import formidable from 'formidable'
import type { Options as FormidableOptions, Fields, Files, Part } from 'formidable'

export interface HoaFormidableOptions extends FormidableOptions {
  parsedMethods?: string[]
  onError?: (err: Error, ctx: HoaContext) => void
  onFileBegin?: (name: string, file: File) => void;
  onPart?: (part: Part, handlePart: (part: Part) => void) => void;
}

/**
 * Formidable middleware for Hoa.
 * Parses multipart/form-data requests using formidable and assigns parsed fields to ctx.req.body and files to ctx.req.files.
 * Designed for use with @hoajs/adapter in Node.js environment.
 *
 * @param {HoaFormidableOptions} [options] - Configuration options, formidable options are passed through.
 * @param {string[]} [options.parsedMethods=['POST','PUT','PATCH']] - HTTP methods whose bodies will be parsed
 * @param {(error: Error, ctx: HoaContext) => void} [options.onError] - Custom error handler; if provided, errors won't throw
 * @returns {HoaMiddleware} The middleware handler function.
 */
export function hoaFormidable (options: HoaFormidableOptions = {}): HoaMiddleware {
  const {
    parsedMethods = ['POST', 'PUT', 'PATCH'],
    onError,
    onFileBegin,
    onPart,
    ...formidableOptions
  } = options

  return async function hoaFormidableMiddleware (ctx: HoaContext, next) {
    const method = ctx.req.method
    if (!parsedMethods.includes(method)) {
      return next()
    }

    const contentType = ctx.req.type
    if (!contentType || !contentType.startsWith('multipart/form-data')) {
      return next()
    }

    const body = ctx.req.body
    if (!body || typeof (body as any).pipe !== 'function') {
      return next()
    }

    try {
      const form = formidable({ multiples: true, ...formidableOptions })
      if (onPart) {
        const delegate = form._handlePart.bind(form)
        form.onPart = (part: Part) => {
          onPart(part, delegate)
        }
      }

      if (onFileBegin) {
        form.on('fileBegin', onFileBegin)
      }
      const [fields, files] = await form.parse(body)
      ctx.req.body = convertFormidableFields(fields)
      ;(ctx.req as any).files = convertFormidableFiles(files)
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err as Error, ctx)
        return next()
      }
      ctx.throw(400, (err as Error).message, { cause: err })
    }

    await next()
  }
}

type ScalarOrArrayFields = {
  [field: string]: string | string[];
}

type ScalarOrArrayFiles = {
  [file: string]: File | File[];
}

export type ParseWithFormidableResult = {
  fields: ScalarOrArrayFields;
  files: ScalarOrArrayFiles;
}

export function convertFormidableFields (fields: Fields): ScalarOrArrayFields {
  const result: ScalarOrArrayFields = {}

  for (const key in fields) {
    const value = fields[key]
    if (value !== undefined) {
      result[key] = value.length === 1 ? value[0] : value
    }
  }

  return result
}

export function convertFormidableFiles (files: Files): ScalarOrArrayFiles {
  const result: ScalarOrArrayFiles = {}

  for (const key in files) {
    const value = files[key]
    if (value !== undefined) {
      result[key] = value.length === 1 ? value[0] : value
    }
  }

  return result
}

export default hoaFormidable
