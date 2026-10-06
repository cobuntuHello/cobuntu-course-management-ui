// @cobuntu/course-management-ui — shared course (learning) authoring surface.
//
// A course is a `products` row with productType=COURSE, so the product form and
// manage page come from @cobuntu/product-management-ui. This package owns the
// pieces that have no product analog: the syllabus builder, the quiz editor,
// and the learning API layer — all consumed by both community-app and admin.
//
// Player/storefront components (CourseDetailView, CoursePlayerShell,
// LessonPlayer, etc.) deliberately stay in community-app.

export {
  CourseManagementConfigProvider,
  useCourseManagementConfig,
  getCourseManagementConfig,
  type CourseManagementConfig,
} from "./config";

// Authoring surface + API layer are exported here as they are extracted:
//   export { CourseBuilder } from "./components/CourseBuilder.client";
//   export * from "./lib/api-learning-authoring";
//   export * from "./lib/api-learning-quizzes";
//   export * from "./lib/courseRuntime";
