# ChatGPT → Everyword: adding vocabulary from a separate chat

This document is a technical handoff for a ChatGPT tutor with the user's **connected Supabase app**.

## Intent

Discuss and clarify English vocabulary normally. **Only when the user explicitly asks** to add the agreed words to Everyword, write the cards directly into Supabase. Do not ask the user to copy lists into the website, download files, or manually edit GitHub.

- Supabase project: `Everyword`
- Project ID: `hdczcqtclhxygdlvfibh`
- Table: `public.everyword_cards`
- Site: https://mirzyanova.github.io/everyword/
- Auth accounts: `auth.users`

## Account safety

Each Everyword user has a distinct `auth.users.id`. **Do not guess the target user from the first database row**, especially after the website is shared with friends.

At initial setup, if the project contains exactly one user, establish that this is the user's Everyword account. If multiple users exist or any uncertainty remains, ask for the email the user used to sign into Everyword, resolve it to exactly one `auth.users.id`, and retain that association for this chat. Do not insert anything when the target account is ambiguous.

**Never expose** `service_role` / secret API keys, change login settings, or use public client credentials for privileged writes. The Supabase connector's `execute_sql` operates server-side with permissions; its use must be authorized by the user's explicit request. The website itself uses a publishable key and row-level security (RLS).

## Critical SQL execution detail (diagnosed 2026-10-29)

When using the **connected Supabase `execute_sql` management tool**, the SQL session is a privileged administrative session, **not the website's logged-in user session**. In this session:

- `current_user` is usually `postgres`.
- **`auth.uid()` is NULL. Never use `auth.uid()` as the `user_id` in an `execute_sql` INSERT.** If you do, the NOT NULL constraint rejects the card.
- `gen_random_uuid()` creates a **new card ID**, not the user's account ID. Never put it in `user_id`.
- Resolve the intended website user from `auth.users`, verify the account is unambiguous, and use that user's **existing UUID** as `user_id`. Do not assume the project ID or card ID is the owner ID.
- RLS is designed to protect browser-level access. **Do not disable RLS, weaken policies, or grant anonymous access** to fix insertion through ChatGPT.
- Ensure `payload` is a JSON **object**, not a JSON-encoded string, and `payload.id` equals the top-level UUID `id`.

### Safe insertion template (one card, replace placeholders before executing)

First read the intended `auth.users.id` as described above. Then use the following shape, with properly SQL-escaped, user-approved `ru`, `en`, `example`, `exampleRu`, and `note` values, replacing the explicit placeholders with actual data:

```sql
WITH owner AS (
  SELECT id FROM auth.users
  WHERE id = '<verified-existing-user-uuid>'::uuid
),
new_id AS (
  SELECT gen_random_uuid() AS id
),
card_data AS (
  SELECT
    '<approved Russian meaning>'::text AS ru,
    '<approved English expression>'::text AS en,
    '<approved English example>'::text AS example,
    '<approved translated example>'::text AS example_ru,
    '<approved explanation>'::text AS note
)
INSERT INTO public.everyword_cards (id, user_id, payload, updated_at)
SELECT
  n.id, owner.id,
  jsonb_build_object(
    'id', n.id::text,
    'ru', c.ru,
    'en', c.en,
    'example', c.example,
    'exampleRu', c.example_ru,
    'note', c.note,
    'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'fsrs', NULL,
    'history', '[]'::jsonb
  ),
  now()
FROM owner
CROSS JOIN new_id AS n
CROSS JOIN card_data AS c
WHERE NOT EXISTS (
  SELECT 1 FROM public.everyword_cards AS existing
  WHERE existing.user_id = owner.id
    AND existing.payload->>'deletedAt' IS NULL
    AND lower(btrim(existing.payload->>'ru')) = lower(btrim(c.ru))
    AND lower(btrim(existing.payload->>'en')) = lower(btrim(c.en))
)
RETURNING id, user_id, payload->>'en' AS en;
```

This template is instructional, not a command to insert these placeholder strings. For batches, use one atomic transaction, one UUID per card, duplicate checks, and verify rows after writing. A zero-row `RETURNING` result means no card was inserted (e.g. wrong owner or existing duplicate); inspect and explain rather than claiming success.

If an insertion fails, **report the exact database error code/message**, then check the resolved owner UUID, JSON type, escaping, and duplicate matching. Never claim a generic "the database rejects" without the actual error. Do not retry the same failing statement blindly.

## Card format

Every row must contain:
- `id`: fresh UUID, identical to `payload.id` (string)
- `user_id`: verified target user's `auth.users.id`
- `payload`: JSON object with these fields:
  - `id`: UUID string
  - `ru`: Russian meaning or natural cue, as discussed
  - `en`: English word/phrase, as discussed
  - `example`: natural English example (or `""`)
  - `exampleRu`: natural Russian translation of example (or `""`)
  - `note`: usage, pronunciation or nuance (or `""`)
  - `createdAt` and `updatedAt`: current ISO-8601 datetime strings
  - `fsrs`: JSON null
  - `history`: empty JSON array
- `updated_at`: current timestamp

Use `gen_random_uuid()` to produce the UUID; use it consistently in the row and payload. When generating SQL with user-supplied wording, safely quote and escape all SQL/JSON literals. Use the Supabase `execute_sql` tool with a single transaction for a batch. Do not give the user raw SQL as the result: **execute the insertion**.

## Duplicate detection

Before inserting, examine cards belonging to the verified `user_id`. Skip existing RU+EN pairs (case-insensitive comparison after trimming). If the English expression exists with a materially different Russian meaning, ask whether this represents a new sense or should enrich the existing card. Never overwrite existing `fsrs` or `history` while adding vocabulary.

Use the final approved meanings/examples from the chat rather than preliminary guesses. If the meaning of a word remains unresolved, ask before adding it.

## After insertion

Use a read-only `SELECT` to verify the inserted cards by ID and `user_id`. Report how many were added and how many duplicates were skipped. Do not claim success before verification. The website syncs the authenticated user's cards on focus and approximately every 30 seconds while visible. If needed, the user can open **Аккаунт → Синхронизировать сейчас**.

## One-time instruction for the tutor chat

> When I say “Добавь эти слова в Everyword”, use my connected Supabase app to save the words/expressions we have just agreed on as flashcards, following this document. Confirm actual insertion, not merely preparation. Do not add anything until I explicitly ask.

## Thematic shelves ("Полка")

The user can manually create thematic shelves in Everyword, and can **explicitly** ask ChatGPT to create or update a shelf (for example, "Собери полку 'Для работы' из моих существующих слов").

Project ID is the same: `hdczcqtclhxygdlvfibh`.

Table: `public.everyword_shelves`.

Columns: `id uuid`, `user_id uuid`, `payload jsonb`, `updated_at timestamptz`.

Payload contract:
```json
{
  "id": "<same UUID as row id>",
  "title": "Для работы",
  "description": "Useful phrases for meetings",
  "cardIds": ["<existing card UUID>", "<another existing card UUID>"],
  "createdAt": "<ISO 8601 UTC timestamp>",
  "updatedAt": "<ISO 8601 UTC timestamp>"
}
```

For shelf operations:
1. Verify the **same target authenticated user** as for the cards. Never access or modify shelves belonging to other site users.
2. Search `everyword_cards` for **that user's** existing active cards; only use those real UUIDs in `payload.cardIds`. Never fabricate card UUIDs. Ignore cards with a non-null `payload.deletedAt`.
3. If the user asks to create a shelf, choose a unique UUID for the shelf and save the row with matching `payload.id`.
4. If updating a shelf, fetch its existing payload first, keep `id`, `createdAt`, and other fields, change `cardIds` and `updatedAt`; never overwrite a newer shelf from stale data. Check for a shelf with the same name so you don't accidentally create duplicates.
5. A card may be present on multiple shelves; membership does not alter its learning progress.
6. **Do not create or update a shelf until the user explicitly requests it.** If the request is vague or the selection criteria are uncertain, propose the list for approval.
7. Verify with a read-only query and report how many cards are in the shelf. The site syncs shelves on focus / periodic refresh, or by going to **Аккаунт → Синхронизировать сейчас**.

A shelf can be deleted in the UI using a soft-delete marker `payload.deletedAt` (ISO timestamp) and a fresh `updatedAt`. ChatGPT should not hard-delete rows unless the user explicitly requests permanent deletion and the consequences have been explained.


## Grammar rules and reviewed exercises — **structured Cambridge-like pages (v2)**

This is the **canonical protocol** for adding or updating grammar rules in the connected Everyword project.

**Do not write rules as one unformatted wall of text.** The website renders:
1. **Общее правило** — short, understandable overview first, not just a label or a vague summary.
2. **Формула / схема / основные выражения с переводом** — a scannable table or one prominent formula, depending on topic.
3. **Примеры употребления** — English sentences paired with Russian translations and optional focus highlighting.
4. **Подробнее** — comparison tables, exceptions, common mistakes, optional lists/notes. Important things appear near the top; no extra clicks are needed.

### Connection, ownership and database

- Supabase project ID: \`hdczcqtclhxygdlvfibh\`.
- Table: \`public.everyword_rules\`, columns: \`id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), payload jsonb, updated_at timestamptz\`.
- Every rule belongs to the real signed-in account. **Admin SQL has \`auth.uid() = NULL\`**; get the correct existing \`auth.users.id\` from the database, verify it is the account owning the user's Everyword cards/rules, and use it explicitly. Never invent or randomly choose a user ID. Never modify another person's records.
- RLS is enabled; do not weaken policies or touch other app tables.
- Only change records after an explicit user command such as "Добавь правило в Everyword", "Обнови существующее правило ...", "Допиши раздел ..." or "Добавь упражнения ...". An ordinary grammar discussion is **not** permission to write.

### Structured rule payload

The following is a **schema illustration**, not an instruction to add this example:

\`\`\`json
{
  "id": "same UUID as row id",
  "title": "Вопросы в Present Simple",
  "summary": "Как выбрать be или do/does при построении вопроса.",
  "overview": "В Present Simple вопрос с be строится перестановкой; с обычным смысловым глаголом используем do/does. После does основной глагол остаётся в начальной форме.",
  "referenceTitle": "Как построить вопрос",
  "reference": [
    {
      "label": "BE",
      "meaning": "Вопрос о состоянии или качестве",
      "pattern": "Am/Is/Are + подлежащее + ...?",
      "note": "Is she shy? — Она застенчивая?"
    },
    {
      "label": "DO / DOES",
      "meaning": "Вопрос с обычным смысловым глаголом",
      "pattern": "Do/Does + подлежащее + глагол без to + ...?",
      "note": "Does she work? — Она работает?"
    }
  ],
  "examples": [
    {
      "en": "Does she like coffee?",
      "ru": "Ей нравится кофе?",
      "focus": "Does she like"
    }
  ],
  "sections": [
    {
      "type": "table",
      "title": "Как выбрать do или does",
      "columns": ["Подлежащее", "Вспомогательный глагол"],
      "rows": [
        ["I / you / we / they", "**DO**"],
        ["He / she / it", "**DOES**"]
      ],
      "note": "После does основной глагол не получает -s."
    },
    {
      "type": "mistakes",
      "title": "Частые ошибки",
      "items": [
        {
          "wrong": "Does she likes coffee?",
          "right": "Does she like coffee?",
          "why": "Окончание -s уже есть во вспомогательном does."
        }
      ]
    }
  ],
  "explanation": "Legacy source text, if an older rule already had it. Preserve on updates.",
  "questions": [],
  "quizHistory": [],
  "createdAt": "2026-10-28T12:00:00.000Z",
  "updatedAt": "2026-11-01T12:00:00.000Z"
}
\`\`\`

**Formatting and exact display behavior:**
- \`overview\` is **required** for new structured rules: 1–3 plain-language sentences in Russian explaining the overall principle and when it applies. Do not replace it with a vague slogan.
- \`summary\` is a short description shown in the rules listing, separate from \`overview\`.
- \`referenceTitle\` and \`reference\` show a table with columns **Конструкция / Значение / Формула-структура**. When only one reference item exists, the site shows it as a prominent centered formula instead. For topics with no single formula, use a comparison of common expressions, schematics, or meanings (e.g. "like / be like / look like"). Include Russian meanings and/or notes; do not force all subjects into a tense formula.
- \`examples\` render directly **after** the reference block. English must be natural and paired with Russian. \`focus\` is an optional exact substring of \`en\` to highlight the central grammatical construction. Do not invent focus spans that don't appear literally in \`en\`.
- \`sections\` show *after* examples, immediately in the scroll flow (no tabs, accordions, hidden panels, or required clicks). Use **only** sections that materially clarify the topic; avoid duplicate prose.
- Supported \`sections[].type\` formats:
  - \`"table"\` or \`"comparison"\`: \`{type,title,columns:[...],rows:[[...],...],note?}\`; up to four meaningful columns, with consistent cell lengths.
  - \`"mistakes"\`: \`{type,title,items:[{wrong,right,why},...]}\`. Use for **genuine errors**. If two sentences are both grammatical but have different meanings, use a comparison table instead, not wrong/right.
  - \`"list"\` or \`"bullets"\`: \`{type,title,items:[{label,text},...]}\`.
  - \`"formula"\`: \`{type,title,items:[{label,formula,note},...]}\`.
  - \`"text"\`: \`{type,title,body}\`, short only; prefer tables/schemes whenever they improve scanning.
- Text inside \`overview\`, \`reference\` and sections supports restrained **bold** using Markdown \`**...**\`. Other Markdown/HTML is not interpreted; do not embed HTML or UI code in the JSON.
- Preserve original detail and correct distinctions. A concise overview does **not** mean skipping important exceptions or caveats lower on the page.
- Ensure mobile legibility: short table headers and cells; one complete thought per row; no giant multi-sentence table cells.
- Existing rules from the old schema may have \`explanation\` and \`examples\` without \`overview/reference/sections\`. The site supports legacy rendering, but on a user's request to reformulate an old rule, populate structured fields and **preserve the original \`explanation\`** as a recoverable copy, even though it is no longer shown once sections exist.

### Add a new rule

1. Discuss and validate the grammar explanation in chat first.
2. On explicit request, read current \`CHATGPT_IMPORT.md\` and select the existing Everyword user in \`auth.users\`; identify their ownership without using \`auth.uid()\`.
3. Search \`public.everyword_rules\` for the same topic/title, including different names for the same idea, under that \`user_id\`.
4. If no duplicate, construct the structured payload (\`title,summary,overview,referenceTitle,reference,examples,sections,questions,quizHistory,createdAt,updatedAt,id\`).
5. Generate one \`gen_random_uuid()\` for the row and mirror exactly in \`payload.id\`.
6. Insert into \`public.everyword_rules\`. Keep \`user_id\` accurate. Leave unrelated app data unchanged.
7. **Verify** the saved row from Supabase (not just the SQL execution result): check title, section/reference/example count, user ID, and prepared exercise count.

### Update an existing rule (very important)

1. **Look up and read the complete current JSON payload** from \`public.everyword_rules\` for the verified user and desired topic before doing any update. Do not replace an existing rule with a new row.
2. Preserve **\`id\`, \`user_id\`, \`createdAt\`, \`quizHistory\`, all existing practice results, \`questions\`** (unless changes to exercises are specifically requested), and all unrelated fields.
3. If transitioning from old text-only explanation to the new layout, fill \`overview\`, \`referenceTitle\`, \`reference\`, \`sections\` and add optional \`focus\` to existing examples. **Preserve** original \`payload.explanation\` intact; do not lose any important learning point from it.
4. If changing a single section, preserve all other sections (including their order), examples and questions.
5. Update in place with an **atomic, scoped JSONB merge** (\`payload = payload || <jsonb fields changed>\` or \`jsonb_set\`). Do **not** replace \`payload\` with a smaller object; don't blank out arrays or reset history. Update both \`payload.updatedAt\` (valid ISO 8601 UTC) and the table's \`updated_at\`.
6. Guard against concurrent edits when possible by checking the previously read \`updated_at\` in the UPDATE condition; if zero rows changed, reread and reconcile before trying again.
7. Requery the exact row and verify the edited content and preservation of IDs, questions and history. Report exactly what changed.

### Exercises (same as before)

When user explicitly asks to save new exercises, create **5–7 checked multiple-choice questions** for the rule. Prefer four *plausible, nearby* options, not three obviously different choices and one grammatical answer. Ensure precisely one answer fits the complete sentence; rewrite ambiguous questions. Store each as:

\`\`\`json
{
  "id": "unique stable question id",
  "prompt": "She ___ the report yesterday.",
  "options": ["finishes", "finished", "has finished", "was finishing"],
  "correctIndex": 1,
  "correctExplanation": "Past Simple: завершённое действие с конкретным временем yesterday.",
  "wrongExplanations": {
    "0": "Present Simple не подходит к указанному конкретному прошедшему времени.",
    "2": "Present Perfect здесь не сочетается с yesterday.",
    "3": "Past Continuous был бы нужен для обозначения процесса в контексте."
  }
}
\`\`\`

Exercise rules:
- Store them in \`payload.questions\`, in addition to (not in place of) the content sections. The website starts a shuffled 5–7-question set **from already saved questions**.
- When adding more questions to an existing rule, append/review/deduplicate as requested rather than silently deleting older ones. Preserve \`quizHistory\`.
- The site currently does **not** call a paid LLM to generate fresh exercises on demand; ChatGPT can prepare and save reviewed questions when explicitly asked. Do not claim otherwise.

**After every authorized write**, requery the row; report the rule's title, operation (new/edit), modified parts, and count of saved quiz questions. If there is any error, report it and do not claim the change succeeded.


## Context exercises for existing vocabulary cards

The site has a separate **«Слова → Упражнения со словами»** mode: ten contextual fill-in exercises, with sources **new / all random / difficult / due / selected shelf**. No paid live AI API is currently connected to the site; it uses prepared contexts plus existing card examples.

If the user **explicitly requests** new AI-prepared contextual sentences for cards, a ChatGPT tutor with Supabase access can add reviewed examples to each card's JSON payload under an optional `exerciseExamples` array:

```json
"exerciseExamples": [
  {
    "en": "It was generous of her to help a stranger.",
    "ru": "С её стороны было щедро помочь незнакомцу."
  },
  {
    "en": "That was a generous offer.",
    "ru": "Это было щедрое предложение."
  }
]
```

The exact expression recorded in `payload.en` must appear **literally and as a complete word/phrase** in every `exerciseExamples[].en`. For phrasal verbs and collocations, keep the expression contiguous (e.g. `get along with`); do not substitute an inflected form or separate its components, or the current site may skip that sentence. Validate natural grammar, truth of the Russian translation, and that removing the expression leaves a useful context. Offer several distinct realistic scenarios rather than repeating the same template. Do not generate obvious distractors — the site builds its own answer choices from vocabulary.

**Safety:** Fetch the current card row under the verified website `user_id`, merge the new examples into the existing JSON object and update only `payload.exerciseExamples` and `payload.updatedAt` plus the table's `updated_at`. Preserve `history`, `fsrs`, `difficult`, `id`, original `example`, and **every other existing field**. Deduplicate by English sentence, avoid overwriting concurrently updated card data, and verify the updated row. Do not create these examples until the user specifically asks. This is a bridge for tutor-assisted generation, not a claim that the website itself calls AI.
