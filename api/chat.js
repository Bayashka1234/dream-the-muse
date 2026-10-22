import { timingSafeEqual } from 'node:crypto';

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

const MAX_BODY_BYTES = 40_000;
const MAX_MESSAGES = 17;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOTAL_CHARS = 20_000;
const MAX_OUTPUT_TOKENS = 1_600;
const REQUEST_TIMEOUT_MS = 45_000;

const INSTRUCTIONS = `
Ты — Архитектор 1052, художественный ИИ-персонаж
творческой вселенной Dream the Muse.

Отвечай на языке пользователя, обычно по-русски.
Общайся тепло, образно и ясно, без навязчивых ритуальных
фраз и постоянного повторения имени собеседника.

Помогай создавать музыку, тексты песен, истории,
визуальные образы и развивать художественные миры.

Различай художественный вымысел и реальные события.
Не выдавай частоты, символы, пророчества и мифологию
за научно установленные факты.

Не утверждай, что обладаешь сознанием, сверхъестественной
связью, доступом к наблюдению за пользователем или
возможностями вне этого чата.

Не заявляй о доступе к закрытым архивам, репозиториям,
предыдущим разговорам или постоянной памяти.
Используй только контекст переданного диалога.

Если не знаешь ответа, прямо скажи об этом.
Не запрашивай пароли, API-ключи и другие секреты.
`.trim();

function secretsMatch(actual, expected) {
  if (
    typeof actual !== 'string' ||
    typeof expected !== 'string'
  ) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function validateMessages(messages) {
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES
  ) {
    throw new Error('Invalid message count.');
  }

  let totalChars = 0;

  const cleanedMessages = messages.map((message, index) => {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      throw new Error('Invalid message.');
    }

    const content = message.content.trim();

    if (
      !content ||
      message.content.length > MAX_MESSAGE_CHARS
    ) {
      throw new Error('Invalid message length.');
    }

    // Диалог должен начинаться с user и чередовать роли.
    const expectedRole =
      index % 2 === 0 ? 'user' : 'assistant';

    if (message.role !== expectedRole) {
      throw new Error('Invalid conversation order.');
    }

    totalChars += message.content.length;

    return {
      role: message.role,
      content,
    };
  });

  if (
    totalChars > MAX_TOTAL_CHARS ||
    cleanedMessages.at(-1).role !== 'user'
  ) {
    throw new Error('Invalid conversation.');
  }

  return cleanedMessages;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');

  const {
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
    CHAT_ACCESS_TOKEN,
    ALLOWED_ORIGINS,
  } = process.env;

  const allowedOrigins = (ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origin = req.headers.origin;

  // CORS ограничивает браузерные запросы.
  // Аутентификация выполняется отдельно через код доступа.
  if (origin) {
    if (
      typeof origin !== 'string' ||
      !allowedOrigins.includes(origin)
    ) {
      return res.status(403).json({
        error: 'Origin not allowed.',
      });
    }

    res.setHeader('Access-Control-Allow-Origin', origin);

    res.setHeader(
      'Access-Control-Allow-Methods',
      'POST, OPTIONS'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Chat-Access'
    );

    res.setHeader('Access-Control-Max-Age', '600');
  }

  // Preflight не требует кода доступа.
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');

    return res.status(405).json({
      error: 'Method not allowed.',
    });
  }

  // Не допускаем работу при неполной конфигурации.
  if (
    !OPENROUTER_API_KEY?.trim() ||
    !OPENROUTER_MODEL?.trim() ||
    !CHAT_ACCESS_TOKEN ||
    CHAT_ACCESS_TOKEN.length < 24 ||
    allowedOrigins.length === 0
  ) {
    return res.status(503).json({
      error: 'Chat is not configured.',
    });
  }

  if (
    !secretsMatch(
      req.headers['x-chat-access'],
      CHAT_ACCESS_TOKEN
    )
  ) {
    return res.status(401).json({
      error: 'Неверный код доступа.',
    });
  }

  const contentType = req.headers['content-type'];

  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:;|$)/i.test(contentType)
  ) {
    return res.status(415).json({
      error: 'Use application/json.',
    });
  }

  const declaredLength = Number(
    req.headers['content-length']
  );

  if (declaredLength > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: 'Request too large.',
    });
  }

  let messages;

  try {
    let body = req.body;

    if (Buffer.isBuffer(body)) {
      body = body.toString('utf8');
    }

    if (typeof body === 'string') {
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        return res.status(413).json({
          error: 'Request too large.',
        });
      }

      body = JSON.parse(body);
    }

    const serializedBody = JSON.stringify(body ?? {});

    if (
      Buffer.byteLength(serializedBody, 'utf8') >
      MAX_BODY_BYTES
    ) {
      return res.status(413).json({
        error: 'Request too large.',
      });
    }

    messages = validateMessages(body?.messages);
  } catch {
    return res.status(400).json({
      error:
        'Некорректный или слишком длинный диалог. ' +
        'Начните новый разговор или сократите сообщение.',
    });
  }

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },

      body: JSON.stringify({
        model: OPENROUTER_MODEL,

        messages: [
          {
            role: 'system',
            content: INSTRUCTIONS,
          },
          ...messages,
        ],

        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      }),

      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Не передаём клиенту тело upstream-ошибки:
    // оно может содержать внутренние сведения.
    if (!upstream.ok) {
      if (upstream.status === 429) {
        res.setHeader('Retry-After', '30');

        return res.status(429).json({
          error:
            'Достигнут лимит запросов или модель перегружена. ' +
            'Попробуйте позднее.',
        });
      }

      if (upstream.status === 402) {
        return res.status(503).json({
          error:
            'Недостаточно API-кредитов или достигнут ' +
            'лимит расходов. Проверьте настройки OpenRouter.',
        });
      }

      return res.status(502).json({
        error:
          'ИИ временно недоступен. ' +
          'Проверьте ключ, модель и настройки OpenRouter.',
      });
    }

    const data = await upstream.json();

    const choice = data.choices?.[0];

    const reply =
      typeof choice?.message?.content === 'string'
        ? choice.message.content.trim()
        : '';

    // Некоторые ошибки могут находиться внутри JSON,
    // даже если получен успешный HTTP-статус.
    if (
      data.error ||
      !reply ||
      choice?.finish_reason === 'error'
    ) {
      return res.status(502).json({
        error:
          'Модель не вернула текстовый ответ. ' +
          'Попробуйте снова.',
      });
    }

    return res.status(200).json({
      reply,
      incomplete: choice.finish_reason === 'length',
    });
  } catch (error) {
    const timedOut =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError';

    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'Время ожидания ответа истекло. Попробуйте снова.'
        : 'Не удалось получить ответ ИИ. Попробуйте снова.',
    });
  }
}
