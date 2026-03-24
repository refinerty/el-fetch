# elf — ErrorLess Fetch

A fetch wrapper that captures all network/HTTP/JSON errors and **always resolves with a consistent result shape**.

Since it always resolves without rejecting, consistent branching is possible without `try/catch`.

```js
const result = await elf({ ticket: "TOY", method: "GET", path: "/api/posts" });
if (!result.ok) return;
console.log(result.data);
```

---

## Installation

```bash
npm install el-fetch
```

---

## Quick Start

```js
import elf from "el-fetch";

const result = await elf({ url: "https://api.example.com/users" });

if (result.ok) {
    console.log(result.data);
} else {
    console.error(result.codeMessage); // "An error has occurred."
    console.error(result.codeHint); // "404/un/-1"
}
```

---

## Airplane (Server Profile)

Pre-register shared settings (origin, headers, okCondition, etc.) for repeated calls.  
Register with a `ticket` key and reference it by `ticket` when calling.

```js
elf.setAirplane({
    MY_API: {
        origin: "https://api.example.com",
        headers: { "x-api-key": "MY_SECRET" },
        okCondition: (data) => data?.code === "0000",
        codePath: (data) => data?.code,
        codeMessage: {
            "0000": "Success.",
            9999: "Server error.",
        },
    },
});

const result = await elf({ ticket: "MY_API", path: "/items" });
```

### Factory Function

An airplane can be created dynamically by receiving `$p` (call options).  
Useful for values determined at call time, such as auth headers.

```js
elf.setAirplane({
    AUTH_API: ($p) => ({
        origin: "https://auth.example.com",
        headers: {
            Authorization: $p.auth ? `Bearer ${getToken()}` : undefined,
        },
    }),
});

await elf({ ticket: "AUTH_API", path: "/me", auth: true });
```

---

## Options (`$p`)

| Option            | Type       | Description                                                                |
| ----------------- | ---------- | -------------------------------------------------------------------------- |
| `ticket`          | `string`   | Key of a pre-registered airplane                                           |
| `url`             | `string`   | Full URL. Takes priority over `origin + path`                              |
| `origin`          | `string`   | Server origin. Takes priority over `airplane.origin`                       |
| `path`            | `string`   | API path                                                                   |
| `query`           | `object`   | Query parameter object. Auto-converted to `?k=v` format. Supports arrays   |
| `method`          | `string`   | HTTP method. Default: `GET`                                                |
| `headers`         | `object`   | Additional headers. Merged into `airplane.headers`                         |
| `data`            | `any`      | Request body. `FormData` or a JSON-serializable object                     |
| `credentials`     | `string`   | fetch credentials option. Default: server `omit` / client `same-origin`    |
| `withCredentials` | `boolean`  | Sets `credentials: "include"` when `true`                                  |
| `okCondition`     | `function` | `(data, response) => boolean`. Not called when `status >= 500`             |
| `dataPath`        | `function` | `(data, response) => any`. Extracts value into `result.data`               |
| `codePath`        | `function` | `(data, response) => string`. Extracts the business code from the response |
| `codeMessage`     | `object`   | Code-to-message table scoped to this call only                             |
| `airplane`        | `object`   | Direct airplane injection. Takes priority over `ticket`                    |
| `name`            | `string`   | Call name. Removed from the `payload` log                                  |

---

## Result Shape

Every call always resolves with the shape below.

```ts
{
    ok: boolean; // Final success status
    responseOk: boolean; // HTTP level success (2xx)
    networkOk: boolean; // Network level success. false = server was unreachable
    status: number; // HTTP status code. 0 on network error
    data: any; // Data after dataPath applied
    error: string | null; // Error message string. null on success
    code: string; // Business code. Falls back to -0 / -1 / -2
    codeMessage: string; // Message corresponding to code
    codeHint: string; // CS debug hint in "status/ticketPrefix/code" format
    name: string | null; // $p.name
    response: Response | null; // Raw fetch Response. null on network error
    payload: object; // Call arguments (Authorization/Cookie headers are [REDACTED])
}
```

### Internal Codes (`code`)

When no business code can be extracted from the server response, elf falls back to its own internal codes.

| code | Situation                          |
| ---- | ---------------------------------- |
| `-0` | Success (no error, no code)        |
| `-1` | HTTP error or other error          |
| `-2` | Network error (server unreachable) |

---

## okCondition Behavior

- `status >= 500`: **`ok` is forced to `false` — `okCondition` is never called**
- `status < 500` + `okCondition` provided: the return value of `okCondition` determines `ok`
- No `okCondition`: `responseOk` is used as-is for `ok`

---

## `elf.METHOD`

A convenience constant object for HTTP methods.

```js
elf.METHOD.GET; // "GET"
elf.METHOD.POST; // "POST"
elf.METHOD.PUT; // "PUT"
elf.METHOD.PATCH; // "PATCH"
elf.METHOD.DELETE; // "DELETE"
// Lowercase aliases are also supported
elf.METHOD.post; // "POST"
```

---

## Static API

### `elf.setAirplane(options)`

Registers one or more airplane profiles.

```js
elf.setAirplane({
  MY_API: { origin: 'https://...', headers: { ... } },
});
```

### `elf.getAirplane(ticket, $p)`

Returns the registered airplane for the given ticket. If it is a factory function, calls it with `$p`.

### `elf.getCodeMessage(ticket, code, customCodeMessage?)`

Returns the message string for the given code. Resolution order: `customCodeMessage` → `CODEMESSAGE[ticket]` → `CODEMESSAGE_DEFAULT`

### `elf.getCodeHint(ticket, code, status?)`

Returns a hint string in the `"status/ticketPrefix/code"` format.

---

## Requirements

- Node.js `>= 18` (global `fetch` built-in)
- Browser: any environment with fetch support

---

## License

MIT
