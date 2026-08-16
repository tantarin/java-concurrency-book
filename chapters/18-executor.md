# Executor: задача отдельно от потока

> Пулы потоков

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →

Менеджер загрузок получает много независимых задач. Создавать новый `Thread` для каждой ссылки опасно: тысяча ссылок породит тысячу потоков и может исчерпать память.

`Executor` разделяет два решения: задача описывает, *что* сделать, а исполнитель решает, *когда и каким потоком* её выполнить.

```java
ExecutorService executor =
    Executors.newFixedThreadPool(4);

Future<Download> future =
    executor.submit(downloadTask);
```

В проекте четыре worker-потока забирают загрузки из внутренней очереди. Поэтому ссылок может быть много, но одновременно код выполняют не больше четырёх worker-ов.

`submit` возвращает `Future`. Через него менеджер может отменить конкретную загрузку вызовом `cancel(true)`. Аргумент `true` разрешает послать выполняющему потоку interruption.

Пул необходимо закрыть. `shutdown()` перестаёт принимать новые задачи, но даёт принятым завершиться. Если они не завершились за отведённое время, `shutdownNow()` пытается их прервать.

> **Главная мысль:** Executor управляет ограниченным ресурсом — потоками. Мы отправляем ему задачи, не создавая и не переиспользуя потоки вручную.

## В живом проекте

- [Создание фиксированного пула](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L23-L26)
- [Отправка `Callable` и получение `Future`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L28-L37)
- [Отмена задачи через `Future`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L57-L68)
- [Корректное завершение `ExecutorService`](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L70-L80)

## Дальше

Теперь соберём правила, по которым можно разбирать любой многопоточный код.

---

← [Атомарные compute и merge](./17-compute-and-merge.md) · [Как рассуждать о многопоточном коде](./19-reasoning-about-concurrency.md) →
