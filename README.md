# Многопоточность в Java

Последовательный русскоязычный учебник: от устройства Java и появления потоков до Java Memory Model, конкурентных коллекций и Executor.

Текст хранится в обычных Markdown-файлах. Главы можно читать прямо на GitHub, обсуждать через Issues и улучшать небольшими pull request.

При первом появлении английского понятия рядом указан русский перевод. Все переводы собраны в [словаре терминов](./GLOSSARY.md).

## Оглавление

1. [С чего начинается Java](./chapters/01-java-and-specification.md) — Язык и спецификация
2. [Зачем приложениям несколько потоков](./chapters/02-why-multiple-threads.md) — Практические примеры
3. [Что такое поток](./chapters/03-what-is-thread.md) — Process, stack и heap
4. [Где JVM хранит данные: stack, heap и не только](./chapters/03-java-memory.md) — Области памяти Java-процесса
5. [Наш сервис просмотров](./chapters/04-shared-mutable-state.md) — Общее изменяемое состояние
6. [Как теряется инкремент](./chapters/05-race-condition.md) — Состояние гонки и атомарность
7. [Race condition: когда результат зависит от порядка потоков](./chapters/05-race-condition-details.md) — Состояние гонки, гонка данных и способы исправления
8. [Mutex: один ключ от комнаты](./chapters/06-mutex.md) — Mutual exclusion
9. [synchronized и монитор](./chapters/07-synchronized.md) — Первое исправление
10. [Почему lock — объект](./chapters/08-object-as-lock.md) — Identity и разные замки
11. [Где прячется lock у метода](./chapters/09-synchronized-method.md) — this и MyClass.class
12. [Почему изменения нужно «увидеть»](./chapters/10-visibility.md) — Видимость изменений
13. [Зачем придумали Java Memory Model](./chapters/11-java-memory-model.md) — JMM
14. [Happens-before простыми словами](./chapters/12-happens-before.md) — JLS 17.4.5
15. [Когда одного счётчика мало](./chapters/13-shared-map.md) — Переходим к Map
16. [synchronizedMap: безопасная очередь](./chapters/14-synchronized-map.md) — Один общий lock
17. [Зачем ConcurrentHashMap](./chapters/15-concurrent-hash-map.md) — Конкурентная коллекция
18. [Какие конкурентные коллекции есть в Java](./chapters/15-concurrent-collections-overview.md) — Map, queue, deque, set и copy-on-write
19. [Почему get и put недостаточно](./chapters/16-operation-composition.md) — Композиция операций
20. [Атомарные compute и merge](./chapters/17-compute-and-merge.md) — Правильное обновление
21. [Executor: задача отдельно от потока](./chapters/18-executor.md) — Пулы потоков
22. [Как рассуждать о многопоточном коде](./chapters/19-reasoning-about-concurrency.md) — Итог маршрута

## Сквозной проект

Теория связана с рабочим [многопоточным менеджером загрузок](https://github.com/tantarin/java-concurrency-lab/tree/main/downloader). В подходящих главах есть постоянные ссылки на конкретные строки Java-кода.

## Как читать

Начни с [первой главы](./chapters/01-java-and-specification.md) и двигайся по ссылке «Дальше». Для экспериментов клонируй проект загрузчика и запусти тесты:

```bash
git clone https://github.com/tantarin/java-concurrency-lab.git
cd java-concurrency-lab/downloader
mvn test
```
