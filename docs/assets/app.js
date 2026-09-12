const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
if (storedTheme) root.dataset.theme = storedTheme;

document.querySelector("#theme-button")?.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", root.dataset.theme);
});

const sidebar = document.querySelector("#sidebar");
document.querySelector("#menu-button")?.addEventListener("click", () => sidebar.classList.add("open"));
document.querySelector("#close-menu")?.addEventListener("click", () => sidebar.classList.remove("open"));

const search = document.querySelector("#search");
search?.addEventListener("input", () => {
  const query = search.value.toLocaleLowerCase("ru").trim();
  document.querySelectorAll(".chapter-link").forEach((link) => {
    link.hidden = Boolean(query) && !link.textContent.toLocaleLowerCase("ru").includes(query);
  });
});

const article = document.querySelector("article");
const progress = document.querySelector("#reading-progress");
if (article && progress) {
  const update = () => {
    const start = article.offsetTop;
    const length = Math.max(1, article.offsetHeight - innerHeight);
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, (scrollY - start) / length))})`;
  };
  addEventListener("scroll", update, { passive: true }); update();
}
