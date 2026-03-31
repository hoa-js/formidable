## @hoajs/formidable

Formidable middleware for Hoa. Parses `multipart/form-data` requests using [formidable](https://github.com/node-formidable/formidable), designed for use with `@hoajs/adapter` in Node.js environment.

## Installation

```bash
$ npm i @hoajs/formidable --save
```

## Quick Start

```ts
import { Hoa } from 'hoa'
import { nodeServer } from '@hoajs/adapter'
import { hoaFormidable } from '@hoajs/formidable'

const app = new Hoa()
app.extend(nodeServer())
app.use(hoaFormidable())

app.use(async (ctx) => {
  const fields = ctx.req.body   // parsed form fields
  const files = ctx.req.files   // uploaded files
  ctx.res.body = { fields, files }
})

app.listen(3000)
```

## Documentation

The documentation is available on [hoa-js.com](https://hoa-js.com/middleware/formidable.html)

## Test (100% coverage)

```sh
$ npm test
```

## License

MIT
