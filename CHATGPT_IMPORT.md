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


## Grammar rules and reviewed exercises

When the user asks "Добавь это правило в Everyword", save a clear, accurate explanation to **public.everyword_rules** in the same Supabase project. Do NOT add grammar automatically during an ordinary discussion.

Schema: \`public.everyword_rules(id uuid, user_id uuid, payload jsonb, updated_at timestamptz)\`; RLS is enabled and each user owns only their records. The admin \`execute_sql\` connection has \`auth.uid() = NULL\`: resolve the actual authenticated website account from \`auth.users\`, as for vocabulary cards, and use the existing \`auth.users.id\`. Do not invent the user UUID.

Each grammar rule has the following payload:

\`\`\`json
{
  "id": "the same UUID as the database row id",
  "title": "Past Simple",
  "summary": "Завершённые действия в прошлом",
  "explanation": "Объяснение простым русским языком, включая условия употребления, форму, исключения и типичные ошибки.",
  "examples": [
    {"en": "I met my friend yesterday.", "ru": "Вчера я встретилась с другом."}
  ],
  "questions": [
    {
      "id": "unique-question-id",
      "prompt": "She ___ the report before the meeting yesterday.",
      "options": ["finishes", "finished", "has finished", "was finishing"],
      "correctIndex": 1,
      "correctExplanation": "Past Simple: речь о завершённом действии в конкретный момент прошлого.",
      "wrongExplanations": {
        "0": "Present Simple — не подходит к конкретному прошедшему моменту.",
        "2": "Present Perfect обычно не употребляется с yesterday.",
        "3": "Past Continuous здесь не нужен, потому что речь не о процессе."
      }
    }
  ],
  "quizHistory": [],
  "createdAt": "ISO 8601 UTC timestamp",
  "updatedAt": "ISO 8601 UTC timestamp"
}
\`\`\`

**Question rules:** Create **5–7 well-checked multiple-choice questions** per grammar rule when the user requests exercises or when explicitly asking to add the rule *with exercises*. Prefer 4 plausible, grammatically consistent options; ensure exactly one correct answer in the full context. Distractors should reflect actual confusions in the **same tense/time frame** where sensible; avoid a giveaway such as three present-tense choices and one past-tense answer when past tense is obvious. Every option should have a concise reason, especially wrong choices. If more than one option is defensible, **rewrite the question before storing it**. Provide a range of contexts and avoid repetitive templates. All grammar explanations are in natural Russian; English examples remain in English. Do not insert unreviewed/ambiguous tasks.

**Operations:** Check for a duplicate rule title under the verified user_id. Create a single fresh \`gen_random_uuid()\` for a new rule, mirror it in \`payload.id\`, and construct JSON through \`jsonb_build_object\` or safely escaped JSON. To update an existing rule, fetch its current payload, preserve \`id\`, \`createdAt\` and any \`quizHistory\`, update the relevant fields and \`updatedAt\`. Respect \`deletedAt\` tombstones and user ownership. Never overwrite the user's review history or vocabulary cards.

**Important:** The site's "Составить упражнения" button currently starts a shuffled 5–7-question set drawn from the **saved \`payload.questions\` bank**. The site does NOT yet make paid, live LLM calls. To add more fresh questions now, the tutor chat can generate and save an additional reviewed batch at the user's explicit request; it is not yet automatic through the site. Do not represent this as live AI generation.

As for cards, after executing an authorized SQL write, re-query that exact record and report its title and question count. If the database rejects a write, report its exact error.
