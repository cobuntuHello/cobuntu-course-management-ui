# @cobuntu/course-management-ui

Shared **course (learning) authoring** surface for the Cobuntu apps, mirroring
[`@cobuntu/product-management-ui`](https://github.com/cobuntuHello/cobuntu-product-management-ui)
and `@cobuntu/event-management-ui`.

A course **is a `products` row** with `productType = COURSE`, so the product
details form and the manage page come from `@cobuntu/product-management-ui`.
This package owns the pieces a product doesn't have:

- **`CourseBuilder`** — the syllabus authoring surface (sections, lessons,
  media/attachment uploads, preview boundary, quiz hookup).
- **Quiz editor** and in-builder quiz preview.
- The **learning API layer** (`api-learning-authoring`, `api-learning-quizzes`,
  read parts of `api-learning`) and pure helpers (`courseRuntime`,
  `default-template`).

The **player/storefront** components (`CourseDetailView`, `CoursePlayerShell`,
`LessonPlayer`, `VideoControls`, `LessonComments`, `CourseSyllabus`) stay in
community-app — they are not part of this package.

## Consumption

Consumed as **source** (no build step) via `transpilePackages` in each Next app,
exactly like the product/event packages. Each app injects its API base + auth:

```tsx
<CourseManagementConfigProvider value={{ apiBaseUrl: "", authHeaders: () => ({}) }}>
  {/* community-app: same-origin */}
</CourseManagementConfigProvider>

<CourseManagementConfigProvider
  value={{ apiBaseUrl: process.env.NEXT_PUBLIC_API_URL!, authHeaders: () => ({ Authorization: `Bearer ${token}` }) }}
>
  {/* admin */}
</CourseManagementConfigProvider>
```

## Scripts
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — vitest
