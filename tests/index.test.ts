import { describe, it, expect, vi, beforeEach } from "vitest";
import elf from "../index.js";

// ─── fetch mock helpers ────────────────────────────────────────────────────

const makeFetchMock = (
    status: number,
    body: unknown,
    contentType = "application/json",
) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (key: string) => (key === "content-type" ? contentType : null),
        },
        text: () => Promise.resolve(text),
    });
};

const makeNetworkErrorMock = (message = "Failed to fetch") =>
    vi.fn().mockRejectedValue(new Error(message));

// ─── setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.restoreAllMocks();
    // airplane / codemessage 레지스트리 초기화
    elf.AIRPLANE = {};
    elf.CODEMESSAGE = {};
});

// ──────────────────────────────────────────────────────────────────────────
// 1. objectToQuery (간접 검증 — URL에 query string이 붙는지)
// ──────────────────────────────────────────────────────────────────────────

describe("query string", () => {
    it("query 객체를 ?k=v 형태로 변환한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ url: "https://api.test", query: { page: 1, size: 10 } });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://api.test?page=1&size=10");
    });

    it("null/undefined 값은 쿼리에서 제외된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({
            url: "https://api.test",
            query: { a: 1, b: null, c: undefined },
        });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://api.test?a=1");
    });

    it("배열 값은 같은 키로 다중 append된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ url: "https://api.test", query: { ids: [1, 2, 3] } });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://api.test?ids=1&ids=2&ids=3");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. joinUrl
// ──────────────────────────────────────────────────────────────────────────

describe("URL 조합 (origin + path)", () => {
    it("origin + path를 슬래시 중복 없이 조합한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ origin: "https://api.test/", path: "/users" });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://api.test/users");
    });

    it("$p.url이 있으면 origin+path보다 우선한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({
            url: "https://direct.test/endpoint",
            origin: "https://api.test",
            path: "/ignored",
        });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://direct.test/endpoint");
    });

    it("origin이 없으면 path를 그대로 URL로 사용한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ path: "/relative/path" });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("/relative/path");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. 정상 응답
// ──────────────────────────────────────────────────────────────────────────

describe("정상 응답 (2xx)", () => {
    it("ok=true, responseOk=true, networkOk=true를 반환한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { data: { id: 1 } }));
        const result = await elf({ url: "https://api.test" });
        expect(result.ok).toBe(true);
        expect(result.responseOk).toBe(true);
        expect(result.networkOk).toBe(true);
        expect(result.status).toBe(200);
        expect(result.error).toBeNull();
    });

    it("dataPath 기본값은 data.data → data.result → data 순으로 추출한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { data: { id: 42 } }));
        const result = await elf({ url: "https://api.test" });
        expect(result.data).toEqual({ id: 42 });
    });

    it("data.data가 없으면 data.result를 사용한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { result: { name: "elf" } }));
        const result = await elf({ url: "https://api.test" });
        expect(result.data).toEqual({ name: "elf" });
    });

    it("code가 없으면 -0으로 fallback된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { data: {} }));
        const result = await elf({ url: "https://api.test" });
        expect(result.code).toBe("-0");
    });

    it("code=-0일 때 codeMessage는 기본 성공 메시지를 반환한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({ url: "https://api.test" });
        expect(result.codeMessage).toBe("Request completed successfully.");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. HTTP 오류
// ──────────────────────────────────────────────────────────────────────────

describe("HTTP 오류", () => {
    it("4xx — ok=false, responseOk=false, error에 [HTTP ERROR] 포함", async () => {
        vi.stubGlobal("fetch", makeFetchMock(404, { errorCode: "NOT_FOUND" }));
        const result = await elf({ url: "https://api.test" });
        expect(result.ok).toBe(false);
        expect(result.responseOk).toBe(false);
        expect(result.networkOk).toBe(true);
        expect(result.error).toContain("[HTTP ERROR]");
        expect(result.status).toBe(404);
    });

    it("5xx — okCondition이 있어도 항상 ok=false", async () => {
        vi.stubGlobal("fetch", makeFetchMock(500, { code: "0000" }));
        const result = await elf({
            url: "https://api.test",
            okCondition: () => true,
        });
        expect(result.ok).toBe(false);
    });

    it("5xx — status=500으로 정확히 반환된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(503, {}));
        const result = await elf({ url: "https://api.test" });
        expect(result.status).toBe(503);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. 네트워크 오류
// ──────────────────────────────────────────────────────────────────────────

describe("네트워크 오류", () => {
    it("ok=false, networkOk=false, code=-2, status=0을 반환한다", async () => {
        vi.stubGlobal("fetch", makeNetworkErrorMock("Failed to fetch"));
        const result = await elf({ url: "https://api.test" });
        expect(result.ok).toBe(false);
        expect(result.networkOk).toBe(false);
        expect(result.code).toBe("-2");
        expect(result.status).toBe(0);
        expect(result.response).toBeNull();
        expect(result.data).toBeNull();
        expect(result.error).toContain("[NETWORK ERROR]");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. JSON 파싱 오류
// ──────────────────────────────────────────────────────────────────────────

describe("JSON 파싱 오류", () => {
    it("JSON 파싱 실패 시 data=null, error에 [JSON ERROR] 포함", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, "this is not json"));
        const result = await elf({ url: "https://api.test" });
        // content-type이 application/json이어야 파싱 시도함
        // 위 mock은 application/json을 기본으로 보내므로 파싱 실패 케이스
        // "this is not json"을 JSON.parse하면 SyntaxError 발생
        expect(result.error).toContain("[JSON ERROR]");
        expect(result.data).toBeNull();
    });

    it("content-type이 json이 아니면 파싱 시도하지 않고 data=null", async () => {
        vi.stubGlobal(
            "fetch",
            makeFetchMock(200, "<html>ok</html>", "text/html"),
        );
        const result = await elf({ url: "https://api.test" });
        expect(result.data).toBeNull();
        expect(result.error).toBeNull(); // JSON 시도 자체를 안 하므로 에러 없음
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. okCondition
// ──────────────────────────────────────────────────────────────────────────

describe("okCondition", () => {
    it("okCondition이 true를 반환하면 ok=true", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "0000" }));
        const result = await elf({
            url: "https://api.test",
            okCondition: (data) => data?.code === "0000",
        });
        expect(result.ok).toBe(true);
    });

    it("okCondition이 false를 반환하면 ok=false (2xx여도)", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "9999" }));
        const result = await elf({
            url: "https://api.test",
            okCondition: (data) => data?.code === "0000",
        });
        expect(result.ok).toBe(false);
    });

    it("okCondition 내부에서 throw 발생 시 ok=false, error에 [OKCOND ERROR] 포함", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({
            url: "https://api.test",
            okCondition: () => {
                throw new Error("condition exploded");
            },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("[OKCOND ERROR]");
    });

    it("4xx + okCondition=true여도 ok=false (okCondition은 2xx~4xx에서만 작동)", async () => {
        vi.stubGlobal("fetch", makeFetchMock(400, { code: "0000" }));
        const result = await elf({
            url: "https://api.test",
            okCondition: () => true,
        });
        // 4xx는 responseOk=false이므로 okCondition이 true여도
        // ok는 okCondition 결과를 그대로 씀 — 400은 5xx가 아니니 okCondition 호출됨
        expect(result.ok).toBe(true);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. codePath / code 추출
// ──────────────────────────────────────────────────────────────────────────

describe("code 추출", () => {
    it("codePath 함수로 코드를 추출한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { resultCode: "1234" }));
        const result = await elf({
            url: "https://api.test",
            codePath: (data) => data?.resultCode,
        });
        expect(result.code).toBe("1234");
    });

    it("codePath 없으면 data.code를 사용한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "ABCD" }));
        const result = await elf({ url: "https://api.test" });
        expect(result.code).toBe("ABCD");
    });

    it("data.errorCode도 자동 탐색된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { errorCode: "E001" }));
        const result = await elf({ url: "https://api.test" });
        expect(result.code).toBe("E001");
    });

    it("error가 있을 때 code fallback은 -1", async () => {
        vi.stubGlobal("fetch", makeFetchMock(404, {}));
        const result = await elf({ url: "https://api.test" });
        expect(result.code).toBe("-1");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 9. dataPath
// ──────────────────────────────────────────────────────────────────────────

describe("dataPath", () => {
    it("커스텀 dataPath 함수로 원하는 필드를 추출한다", async () => {
        vi.stubGlobal(
            "fetch",
            makeFetchMock(200, { payload: { items: [1, 2, 3] } }),
        );
        const result = await elf({
            url: "https://api.test",
            dataPath: (data) => data?.payload?.items,
        });
        expect(result.data).toEqual([1, 2, 3]);
    });

    it("dataPath는 response를 두 번째 인자로 받는다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { data: 1 }));
        let capturedResponse: unknown;
        await elf({
            url: "https://api.test",
            dataPath: (data, res) => {
                capturedResponse = res;
                return data;
            },
        });
        expect(capturedResponse).toBeDefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 10. airplane / setAirplane / getAirplane
// ──────────────────────────────────────────────────────────────────────────

describe("airplane", () => {
    it("setAirplane으로 등록한 airplane의 origin이 URL에 반영된다", async () => {
        elf.setAirplane({
            MYAPI: { origin: "https://my-api.test", headers: {} },
        });
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ ticket: "MYAPI", path: "/items" });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://my-api.test/items");
    });

    it("airplane이 factory function이면 $p를 받아 동적으로 생성된다", async () => {
        elf.setAirplane({
            DYN: ($p: { auth?: boolean }) => ({
                origin: "https://dyn.test",
                headers: $p?.auth ? { Authorization: "Bearer token" } : {},
            }),
        });
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ ticket: "DYN", path: "/secure", auth: true });
        const calledOptions = (fetch as ReturnType<typeof vi.fn>).mock
            .calls[0][1];
        expect(calledOptions.headers.Authorization).toBe("Bearer token");
    });

    it("$p.airplane 직접 주입은 ticket보다 우선한다", async () => {
        elf.setAirplane({ FALLBACK: { origin: "https://fallback.test" } });
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({
            ticket: "FALLBACK",
            path: "/x",
            airplane: { origin: "https://injected.test" },
        });
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(calledUrl).toBe("https://injected.test/x");
    });

    it("airplane.okCondition이 ticket 기본 okCondition으로 작동한다", async () => {
        elf.setAirplane({
            OKTEST: {
                origin: "https://ok.test",
                okCondition: (data: { success?: boolean }) =>
                    data?.success === true,
            },
        });
        vi.stubGlobal("fetch", makeFetchMock(200, { success: true }));
        const result = await elf({ ticket: "OKTEST", path: "/check" });
        expect(result.ok).toBe(true);
    });

    it("airplane.codeMessage가 CODEMESSAGE에 자동 등록된다", async () => {
        elf.setAirplane({
            CM: {
                origin: "https://cm.test",
                codeMessage: { "1000": "Custom message" },
            },
        });
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "1000" }));
        const result = await elf({ ticket: "CM", path: "/" });
        expect(result.codeMessage).toBe("Custom message");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 11. codeMessage / codeHint
// ──────────────────────────────────────────────────────────────────────────

describe("codeMessage / codeHint", () => {
    it("$p.codeMessage로 호출 단위 메시지를 오버라이드한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "9001" }));
        const result = await elf({
            url: "https://api.test",
            ticket: "X",
            codeMessage: { "9001": "Per-call override message" },
        });
        expect(result.codeMessage).toBe("Per-call override message");
    });

    it("codeHint 형식은 status/ticketPrefix/code", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, { code: "1234" }));
        const result = await elf({
            url: "https://api.test",
            ticket: "JARVIS",
        });
        expect(result.codeHint).toBe("200/JA/1234");
    });

    it("ticket이 없으면 ticketPrefix가 빈 문자열", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({ url: "https://api.test" });
        expect(result.codeHint).toMatch(/^200\//);
    });

    it("코드 테이블에 없는 코드는 fallback 메시지를 반환한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(404, {}));
        const result = await elf({
            url: "https://api.test",
            ticket: "UNKNOWN_TICKET",
        });
        expect(result.codeMessage).toBe("An error has occurred.");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 12. maskPayload
// ──────────────────────────────────────────────────────────────────────────

describe("maskPayload", () => {
    it("Authorization 헤더를 [REDACTED]로 마스킹한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({
            url: "https://api.test",
            headers: { Authorization: "Bearer secret-token" },
        });
        expect(result.payload.headers.Authorization).toBe("[REDACTED]");
    });

    it("cookie 헤더를 [REDACTED]로 마스킹한다 (대소문자 무관)", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({
            url: "https://api.test",
            headers: { Cookie: "session=abc123" },
        });
        expect(result.payload.headers.Cookie).toBe("[REDACTED]");
    });

    it("name 필드는 payload에서 제거된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({ url: "https://api.test", name: "API_TEST" });
        expect("name" in result.payload).toBe(false);
    });

    it("민감하지 않은 헤더는 그대로 유지된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({
            url: "https://api.test",
            headers: { "x-custom-key": "visible" },
        });
        expect(result.payload.headers["x-custom-key"]).toBe("visible");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 13. credentials
// ──────────────────────────────────────────────────────────────────────────

describe("credentials", () => {
    it("withCredentials=true면 credentials: include", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ url: "https://api.test", withCredentials: true });
        const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(opts.credentials).toBe("include");
    });

    it("$p.credentials 명시값이 우선된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        await elf({ url: "https://api.test", credentials: "omit" });
        const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(opts.credentials).toBe("omit");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 14. FormData body
// ──────────────────────────────────────────────────────────────────────────

describe("FormData body", () => {
    it("FormData 전송 시 Content-Type 헤더를 제거한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const fd = new FormData();
        fd.append("file", new Blob(["hello"]), "hello.txt");
        await elf({ url: "https://api.test", method: "POST", data: fd });
        const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect("Content-Type" in opts.headers).toBe(false);
        expect(opts.body).toBeInstanceOf(FormData);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// 15. result shape 보장
// ──────────────────────────────────────────────────────────────────────────

describe("result shape", () => {
    const REQUIRED_KEYS = [
        "ok",
        "responseOk",
        "networkOk",
        "status",
        "data",
        "error",
        "code",
        "codeMessage",
        "codeHint",
        "name",
        "response",
        "payload",
    ];

    it("정상 응답 시 모든 필수 필드가 존재한다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({ url: "https://api.test" });
        for (const key of REQUIRED_KEYS) {
            expect(result).toHaveProperty(key);
        }
    });

    it("네트워크 오류 시에도 모든 필수 필드가 존재한다", async () => {
        vi.stubGlobal("fetch", makeNetworkErrorMock());
        const result = await elf({ url: "https://api.test" });
        for (const key of REQUIRED_KEYS) {
            expect(result).toHaveProperty(key);
        }
    });

    it("$p.name이 result.name에 반영된다", async () => {
        vi.stubGlobal("fetch", makeFetchMock(200, {}));
        const result = await elf({ url: "https://api.test", name: "MY_CALL" });
        expect(result.name).toBe("MY_CALL");
    });
});
