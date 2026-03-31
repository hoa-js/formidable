import { Hoa } from 'hoa'
import { describe, it, expect, afterEach } from '@jest/globals'
import { nodeServer } from '@hoajs/adapter'
import { hoaFormidable, convertFormidableFields, convertFormidableFiles } from '../src/index.ts'
import http from 'node:http'

type Server = http.Server

let servers: Server[] = []

const startServer = (app: any, ...listenArgs: any[]): Promise<Server> =>
  new Promise((resolve, reject) => {
    const s = app.listen(...listenArgs) as Server
    s.on('listening', () => resolve(s))
    s.on('error', reject)
  })

function getPort (server: Server): number {
  return (server.address() as any).port
}

/**
 * Build a raw multipart/form-data body and boundary for fetch.
 */
function buildMultipart (
  fields: Record<string, string>,
  files?: { name: string, filename: string, content: string | Buffer, contentType?: string }[]
): { body: Buffer, boundary: string } {
  const boundary = '----HoaTestBoundary' + Date.now()
  const parts: Buffer[] = []

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
    ))
  }

  if (files) {
    for (const file of files) {
      const ct = file.contentType || 'application/octet-stream'
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${ct}\r\n\r\n`
      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content
      parts.push(Buffer.concat([Buffer.from(header), content, Buffer.from('\r\n')]))
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), boundary }
}

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => {
    if (server && server.listening) {
      server.close(() => resolve())
    } else {
      resolve()
    }
  })))
  servers = []
})

describe('hoaFormidable middleware', () => {
  describe('Basic field parsing', () => {
    it('should parse multipart/form-data text fields', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = ctx.req.body
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart({ name: 'hoa', version: '1.0' })
      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.name).toEqual('hoa')
      expect(json.version).toEqual('1.0')
    })

    it('should parse fields with multiple values for same key', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = ctx.req.body
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const boundary = '----HoaMultiVal' + Date.now()
      const raw =
        `--${boundary}\r\nContent-Disposition: form-data; name="tag"\r\n\r\nalpha\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="tag"\r\n\r\nbeta\r\n` +
        `--${boundary}--\r\n`

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.from(raw)
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.tag).toEqual(['alpha', 'beta'])
    })
  })

  describe('File upload', () => {
    it('should parse single file upload', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        const files = (ctx.req as any).files
        const fileInfo = files?.file
        ctx.res.body = {
          hasFile: !!fileInfo,
          originalFilename: fileInfo?.originalFilename,
          mimetype: fileInfo?.mimetype,
          size: fileInfo?.size
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        { title: 'test' },
        [{ name: 'file', filename: 'test.txt', content: 'hello world', contentType: 'text/plain' }]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.hasFile).toBe(true)
      expect(json.originalFilename).toBe('test.txt')
      expect(json.mimetype).toBe('text/plain')
      expect(json.size).toBe(11)
    })

    it('should parse multiple file uploads', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        const files = (ctx.req as any).files
        ctx.res.body = {
          fileCount: Object.keys(files || {}).length,
          file1Name: files?.file1?.originalFilename,
          file2Name: files?.file2?.originalFilename
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        {},
        [
          { name: 'file1', filename: 'a.txt', content: 'aaa', contentType: 'text/plain' },
          { name: 'file2', filename: 'b.txt', content: 'bbb', contentType: 'text/plain' }
        ]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.fileCount).toBe(2)
      expect(json.file1Name).toBe('a.txt')
      expect(json.file2Name).toBe('b.txt')
    })
  })

  describe('HTTP method filtering', () => {
    it('should skip parsing for GET requests', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'skipped'
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const res = await fetch(`http://localhost:${port}`, { method: 'GET' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('skipped')
    })

    it('should parse PUT requests by default', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = ctx.req.body
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart({ key: 'value' })
      const res = await fetch(`http://localhost:${port}`, {
        method: 'PUT',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.key).toEqual('value')
    })

    it('should parse PATCH requests by default', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = ctx.req.body
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart({ patch: 'data' })
      const res = await fetch(`http://localhost:${port}`, {
        method: 'PATCH',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.patch).toEqual('data')
    })

    it('should respect custom parsedMethods', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({ parsedMethods: ['POST'] }))
      app.use(async (ctx) => {
        ctx.res.body = typeof ctx.req.body === 'object' && ctx.req.body !== null && !(ctx.req.body instanceof ReadableStream) && typeof (ctx.req.body as any).pipe !== 'function'
          ? 'parsed'
          : 'not-parsed'
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart({ data: 'test' })

      // PUT should not be parsed
      const res1 = await fetch(`http://localhost:${port}`, {
        method: 'PUT',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })
      expect(await res1.text()).toBe('not-parsed')

      // POST should be parsed
      const { body: body2, boundary: boundary2 } = buildMultipart({ data: 'test' })
      const res2 = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
        body: body2
      })
      expect(await res2.text()).toBe('parsed')
    })
  })

  describe('Content-Type filtering', () => {
    it('should skip non-multipart content types', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'skipped'
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true })
      })

      expect(res.status).toBe(200)
      expect(await res.text()).toBe('skipped')
    })

    it('should skip requests with no content-type', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'skipped'
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        body: 'raw data'
      })

      expect(res.status).toBe(200)
      expect(await res.text()).toBe('skipped')
    })
  })

  describe('Body type filtering', () => {
    it('should skip when body has no pipe function (non-Node stream)', async () => {
      const app = new Hoa()
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'skipped'
      })

      // Use app.fetch directly (no adapter) — body is ReadableStream, not IncomingMessage
      const { body, boundary } = buildMultipart({ test: 'value' })
      const res = await app.fetch(new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      }))

      expect(res.status).toBe(200)
      expect(await res.text()).toBe('skipped')
    })

    it('should skip when body is null', async () => {
      const app = new Hoa()
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'skipped'
      })

      const res = await app.fetch(new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=test' }
      }))

      expect(res.status).toBe(200)
      expect(await res.text()).toBe('skipped')
    })
  })

  describe('Error handling', () => {
    it('should throw 400 on malformed multipart data by default', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        ctx.res.body = 'should not reach'
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=invalidboundary' },
        body: 'this is not valid multipart data'
      })

      expect(res.status).toBe(400)
    })

    it('should use custom onError handler when provided', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({
        onError: (err, ctx) => {
          ctx.res.status = 422
          ctx.res.body = `Custom: ${err.message}`
        }
      }))
      app.use(async (ctx) => {
        // onError calls next(), so this runs after error
        if (!ctx.res.body) {
          ctx.res.body = 'fallback'
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=badboundary' },
        body: 'invalid data'
      })

      expect(res.status).toBe(422)
      const text = await res.text()
      expect(text).toContain('Custom:')
    })
  })

  describe('Formidable options passthrough', () => {
    it('should respect maxFileSize option', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({
        maxFileSize: 5, // 5 bytes
        onError: (_error: Error, ctx: any) => {
          ctx.res.status = 413
          ctx.res.body = 'File too large'
        }
      } as any))
      app.use(async (ctx: any) => {
        if (!ctx.res.body) {
          ctx.res.body = 'ok'
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        {},
        [{ name: 'file', filename: 'big.txt', content: 'this content exceeds 5 bytes', contentType: 'text/plain' }]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(413)
      expect(await res.text()).toBe('File too large')
    })

    it('should respect keepExtensions option', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({ keepExtensions: true }))
      app.use(async (ctx) => {
        const files = (ctx.req as any).files
        const fileInfo = files?.file
        ctx.res.body = {
          newFilename: fileInfo?.newFilename
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        {},
        [{ name: 'file', filename: 'doc.pdf', content: 'pdf content', contentType: 'application/pdf' }]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.newFilename).toMatch(/\.pdf$/)
    })
  })

  describe('Convert helpers (scalar vs array)', () => {
    it('should skip undefined values in convertFormidableFields', () => {
      const fields = { name: ['hoa'], empty: undefined } as any
      const result = convertFormidableFields(fields)
      expect(result.name).toBe('hoa')
      expect(result).not.toHaveProperty('empty')
    })

    it('should skip undefined values in convertFormidableFiles', () => {
      const files = { doc: undefined, pic: [{ originalFilename: 'a.png' }] } as any
      const result = convertFormidableFiles(files)
      expect(result).not.toHaveProperty('doc')
      expect(result.pic).toEqual({ originalFilename: 'a.png' })
    })

    it('should keep files as array when multiple files share same field name', async () => {
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable())
      app.use(async (ctx) => {
        const files = (ctx.req as any).files
        const docs = files?.doc
        ctx.res.body = {
          isArray: Array.isArray(docs),
          count: Array.isArray(docs) ? docs.length : 1
        }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        {},
        [
          { name: 'doc', filename: 'a.txt', content: 'aaa', contentType: 'text/plain' },
          { name: 'doc', filename: 'b.txt', content: 'bbb', contentType: 'text/plain' }
        ]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.isArray).toBe(true)
      expect(json.count).toBe(2)
    })
  })

  describe('onFileBegin and onPart hooks', () => {
    it('should call onFileBegin when provided', async () => {
      let fileBeginCalled = false
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({
        onFileBegin: (_name, _file) => {
          fileBeginCalled = true
        }
      }))
      app.use(async (ctx) => {
        ctx.res.body = { fileBeginCalled }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart(
        {},
        [{ name: 'file', filename: 'hook.txt', content: 'data', contentType: 'text/plain' }]
      )

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.fileBeginCalled).toBe(true)
    })

    it('should call onPart with part and delegate', async () => {
      let partReceived = false
      const app = new Hoa()
      app.extend(nodeServer())
      app.use(hoaFormidable({
        onPart: (part, handlePart) => {
          partReceived = true
          handlePart(part)
        }
      }))
      app.use(async (ctx) => {
        ctx.res.body = { partReceived, hasFields: !!ctx.req.body }
      })

      const server = await startServer(app, 0, 'localhost')
      servers.push(server)
      const port = getPort(server)

      const { body, boundary } = buildMultipart({ hello: 'world' })

      const res = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.partReceived).toBe(true)
      expect(json.hasFields).toBe(true)
    })
  })

  describe('Default export', () => {
    it('should export default as hoaFormidable', async () => {
      const mod = await import('../src/index.ts')
      expect(mod.default).toBe(mod.hoaFormidable)
    })
  })
})
