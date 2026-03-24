/**
 * @file elf — ErrorLess Fetch
 * @description
 * Wraps fetch to capture all network/HTTP/JSON errors and always resolves
 * with a consistent shape object. Since it always resolves without rejecting,
 * consistent branching is possible without try/catch.
 *
 * Loads a pre-registered airplane (server profile) via ticket
 * and automatically merges origin, headers, okCondition, etc.
 *
 * @example
 * // Initial setup (app entry point or Nuxt plugin)
 * elf.setAirplane(airplanes);
 *
 * // Call
 * const result = await elf({ ticket: 'TOY', method: 'GET', path: '/api/posts' });
 * if (!result.ok) return;
 * console.log(result.data);
 */

/**
 * @typedef {Object} ElfResult
 * @property {boolean}       ok          - Final success status. Result of okCondition if provided, otherwise responseOk.
 *                                         okCondition is skipped when status >= 500 — always false in that case.
 * @property {boolean}       responseOk  - HTTP level success (2xx)
 * @property {boolean}       networkOk   - Network level success. false means the server was unreachable
 * @property {number}        status      - HTTP status code. 0 on network error
 * @property {any}           data        - Data after dataPath applied. null if JSON parsing fails
 * @property {string|null}   error       - Error message string. null on success
 * @property {string}        code        - Server business code. Falls back to elf internal code (-0/-1/-2)
 * @property {string}        codeMessage - Message corresponding to code. Falls back to default error message if not in table
 * @property {string}        codeHint    - Debug hint in "status/first2charsOfTicket/code" format for CS
 * @property {string|null}   name        - Call name. Specified via $p.name
 * @property {Response|null} response    - Raw fetch Response. null on network error
 * @property {object}        payload     - Call arguments. Authorization/Cookie headers are [REDACTED]
 */

/**
 * @typedef {Object} ElfAirplane
 * @property {string}    [origin]       - Server origin URL
 * @property {object}    [headers]      - Default headers merged into every request
 * @property {function}  [okCondition]  - (data, response) => boolean
 * @property {function}  [dataPath]     - (data, response) => any
 * @property {function}  [codePath]     - (data, response) => string
 * @property {object}    [codeMessage]  - Code to message table
 */

/**
 * @param {object}    $p                    - Call options
 * @param {string}    [$p.ticket]           - Key of pre-registered airplane
 * @param {string}    [$p.url]              - Full URL. Takes priority over origin+path
 * @param {string}    [$p.origin]           - Server origin. Takes priority over airplane.origin
 * @param {string}    [$p.path]             - API path
 * @param {object}    [$p.query]            - Query parameter object. Auto-converted to ?k=v format
 * @param {string}    [$p.method]           - HTTP method. Default: GET
 * @param {object}    [$p.headers]          - Additional headers. Merged into airplane.headers
 * @param {any}       [$p.data]             - Request body. FormData or JSON-serializable object
 * @param {string}    [$p.credentials]      - fetch credentials option. Default: server omit / client same-origin
 * @param {boolean}   [$p.withCredentials]  - true sets credentials: "include"
 * @param {function}  [$p.okCondition]      - (rawData, response) => boolean. Fully delegates ok determination if provided.
 *                                            Not called when status >= 500.
 * @param {function}  [$p.dataPath]         - (rawData, response) => any. Extracts value to reflect in result.data
 * @param {function}  [$p.codePath]         - (rawData, response) => string. Extracts business code from server response
 * @param {object}    [$p.codeMessage]      - Code to message table used only for this call.
 *                                            When using airplane direct injection without ticket, falls back to airplane.codeMessage.
 * @param {ElfAirplane|function} [$p.airplane] - Direct airplane object injection. Takes priority over ticket.
 *                                               airplane.codeMessage is used when ticket is not provided.
 * @param {string}    [$p.name]             - Call name. Removed from payload log
 * @returns {Promise<ElfResult>}
 */

const objectToQuery = (...objs) => {
    const params = new URLSearchParams();
    for (const obj of objs.filter(Boolean)) {
        for (const [k, v] of Object.entries(obj)) {
            if (v === undefined || v === null) {
                continue;
            }
            if (Array.isArray(v)) {
                v.forEach((item) => params.append(k, String(item)));
            } else {
                params.append(k, String(v));
            }
        }
    }
    const s = params.toString();
    return s ? `?${s}` : "";
};

const joinUrl = (origin, path) => {
    if (!origin) {
        return path || "";
    }
    if (!path) {
        return origin;
    }

    const cleanOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
    const cleanPath = path.startsWith("/") ? path : `/${path}`;

    return cleanOrigin + cleanPath;
};

const maskPayload = (p) => {
    const payload = { ...p };
    if (payload.headers && typeof payload.headers === "object") {
        const masked = { ...payload.headers };
        for (const key of Object.keys(masked)) {
            const lower = key.toLowerCase();
            if (lower === "authorization" || lower === "cookie") {
                masked[key] = "[REDACTED]";
            }
        }
        payload.headers = masked;
    }
    return payload;
};

const extractCode = (codePath, data, response) => {
    if (typeof codePath === "function") {
        try {
            const code = codePath(data, response);
            if (code !== null && code !== undefined) {
                return code;
            }
        } catch {}
    }
    return (
        data?.code ??
        data?.errorCode ??
        data?.errorcode ??
        data?.error?.code ??
        data?.error?.errorCode ??
        null
    );
};

const elf = async function ($p = {}) {
    const name = $p.name || null;
    const method = $p.method || elf.METHOD.GET;
    const airplane = $p.airplane || elf.getAirplane($p.ticket, $p) || null;

    const query = $p.query ? objectToQuery($p.query) : "";
    const origin = $p.origin || airplane?.origin || "";
    const path = $p.path || "";
    const baseUrl = $p.url || joinUrl(origin, path);
    const url = query ? `${baseUrl}${query}` : baseUrl;

    const isServer = typeof window === "undefined";
    const credentials =
        $p.credentials ??
        ($p.withCredentials || $p.withCredential
            ? "include"
            : isServer
              ? "omit"
              : "same-origin");

    const okCondition = $p.okCondition || airplane?.okCondition;
    const dataPath =
        $p.dataPath || airplane?.dataPath || ((d) => d?.data ?? d?.result ?? d);
    const codePath = $p.codePath || airplane?.codePath || null;
    const callCodeMessage = $p.codeMessage || airplane?.codeMessage || null;

    const options = {
        method,
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            ...airplane?.headers,
            ...$p.headers,
        },
        ...$p.options,
        credentials,
    };

    if ($p.data != null) {
        if ($p.data instanceof FormData) {
            if (options.headers && "Content-Type" in options.headers) {
                delete options.headers["Content-Type"];
            }
            options.body = $p.data;
        } else {
            options.body = JSON.stringify($p.data);
        }
    }

    let result;
    try {
        const response = await fetch(url, options);
        const responseOk = response.ok;
        const status = response.status;
        const errors = [];
        let data = null;

        try {
            const ctype = response.headers.get("content-type") || "";
            const text = await response.text();
            if (text && ctype.toLowerCase().includes("application/json")) {
                data = JSON.parse(text);
            }
        } catch (jsonError) {
            errors.push(`[JSON ERROR] ${jsonError.message}`);
        }

        if (!responseOk) {
            errors.push(`[HTTP ERROR] status: ${status}`);
        }

        let ok = responseOk;

        if (status >= 500) {
            ok = false;
        } else if (typeof okCondition === "function") {
            try {
                ok = !!okCondition(data, response);
            } catch (e) {
                ok = false;
                errors.push(`[OKCOND ERROR] ${e.message}`);
            }
        }

        let code = extractCode(codePath, data, response);
        if (code === null || code === undefined) {
            code = errors.length ? "-1" : "-0";
        }

        result = {
            ok,
            responseOk,
            networkOk: true,
            status,
            data: dataPath(data, response),
            error: errors.length ? errors.join(" | ") : null,
            code,
            name,
            response,
            payload: maskPayload($p),
        };
    } catch (networkError) {
        result = {
            ok: false,
            responseOk: false,
            networkOk: false,
            status: 0,
            error: `[NETWORK ERROR] message: ${networkError.message}`,
            response: null,
            data: null,
            code: "-2",
            name,
            payload: maskPayload($p),
        };
    }

    if (result.payload && "name" in result.payload) {
        delete result.payload.name;
    }

    result.codeMessage = elf.getCodeMessage(
        $p.ticket,
        result.code,
        callCodeMessage,
    );
    result.codeHint = elf.getCodeHint($p.ticket, result.code, result.status);

    return result;
};

elf.METHOD = {
    GET: "GET",
    POST: "POST",
    PUT: "PUT",
    PATCH: "PATCH",
    DELETE: "DELETE",
    get: "GET",
    post: "POST",
    put: "PUT",
    patch: "PATCH",
    delete: "DELETE",
};

elf.AIRPLANE = {};
elf.CODEMESSAGE = {};
elf.CODEMESSAGE_DEFAULT = {
    "-0": "Request completed successfully.",
    "-1": "An error has occurred.",
    "-2": "A network error has occurred.",
};

/**
 * Returns the message string for the given ticket + code combination.
 * Resolution order: customCodeMessage → CODEMESSAGE[ticket] → CODEMESSAGE_DEFAULT → fallback string
 * @param {string} ticket
 * @param {string} code
 * @param {object|null} customCodeMessage
 * @returns {string}
 */
elf.getCodeMessage = (ticket = "", code = "", customCodeMessage = null) => {
    const msg =
        customCodeMessage?.[code] ??
        elf.CODEMESSAGE?.[ticket]?.[code] ??
        elf.CODEMESSAGE_DEFAULT?.[code];
    return msg ?? "An error has occurred.";
};

/**
 * Returns a CS-friendly debug hint string: "status/ticketPrefix/code"
 * @param {string} ticket
 * @param {string} code
 * @param {number|undefined} status
 * @returns {string}
 */
elf.getCodeHint = (ticket = "", code = "", status = undefined) => {
    const ticketSign = String(ticket).slice(0, 2);
    const statusLabel = status !== undefined ? status : "-";
    return `${statusLabel}/${ticketSign}/${code}`;
};

/**
 * Resolves and returns an airplane profile by ticket key.
 * If the registered value is a function, calls it with $p to support dynamic profiles.
 * Also populates CODEMESSAGE[ticket] on first access.
 * @param {string} $ticket
 * @param {object} $p - original call options, passed to factory functions
 * @returns {ElfAirplane|null}
 */
elf.getAirplane = ($ticket, $p) => {
    const registered = elf.AIRPLANE[$ticket];
    const airplane =
        typeof registered === "function"
            ? registered($p)
            : (registered ?? null);

    if (!elf.CODEMESSAGE[$ticket] && airplane?.codeMessage) {
        elf.CODEMESSAGE[$ticket] = airplane.codeMessage;
    }
    return airplane;
};

/**
 * Registers one or more airplane profiles.
 * Values can be plain objects or factory functions that receive $p and return an airplane.
 * @param {Record<string, ElfAirplane|function>} $options
 */
elf.setAirplane = ($options) => {
    for (const [k, v] of Object.entries($options || {})) {
        elf.AIRPLANE[k] = v;
        if (typeof v !== "function" && v.codeMessage) {
            elf.CODEMESSAGE[k] = v.codeMessage;
        }
    }
};

export default elf;
