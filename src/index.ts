// @cobuntu/course-management-ui — shared course (learning) authoring surface.
//
// A course is a `products` row with productType=COURSE, so the product form and
// manage page come from @cobuntu/product-management-ui. This package owns the
// pieces that have no product analog: the syllabus builder, the quiz editor,
// and the learning API layer — consumed by both community-app and admin.
//
// Player/storefront components (CourseDetailView, CoursePlayerShell,
// LessonPlayer, VideoControls, LessonComments, CourseSyllabus) deliberately
// stay in community-app.

export {
  CourseManagementConfigProvider,
  useCourseManagementConfig,
  getCourseManagementConfig,
  type CourseManagementConfig,
} from "./config";

// ── API layer (config-injected; client-side authoring + reads) ──────────────
export { apiClient, ApiError, type ApiClientOptions } from "./lib/api";
export * from "./lib/api-learning";
export * from "./lib/api-learning-authoring";
export * from "./lib/api-learning-quizzes";
export * from "./lib/courseRuntime";

// ── Authoring surface ───────────────────────────────────────────────────────
export { CourseBuilder } from "./components/CourseBuilder.client";
export * from "./components/QuizEditor.client";
export { QuizPlayer } from "./components/QuizPlayer.client";
export * from "./components/BuilderModal.client";
