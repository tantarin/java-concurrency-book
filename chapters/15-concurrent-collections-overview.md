# Какие конкурентные коллекции есть в Java

> Map, queue, deque, set и copy-on-write

← [synchronizedMap: безопасная очередь](./14-synchronized-map.md) · [Зачем ConcurrentHashMap](./15-concurrent-hash-map.md) →

Обычные `ArrayList`, `HashMap` и `ArrayDeque` не предназначены для конкурентного изменения. Если несколько потоков работают с одной коллекцией, недостаточно выбрать любой класс со словом `Concurrent` в названии: разные коллекции решают разные задачи.

**Concurrent collections (конкурентные коллекции)** предоставляют потокобезопасные операции и рассчитаны на одновременную работу нескольких потоков. Основные реализации находятся в пакете `java.util.concurrent`.

## Карта основных коллекций

| Задача | Коллекция | Главное свойство |
|---|---|---|
| Быстрый доступ по ключу | `ConcurrentHashMap` | конкурентные чтения и обновления отдельных ключей |
| Отсортированная Map | `ConcurrentSkipListMap` | ключи упорядочены, доступны диапазоны |
| Отсортированный Set | `ConcurrentSkipListSet` | конкурентное множество с сортировкой |
| Частые чтения, редкие записи | `CopyOnWriteArrayList` | чтение без блокировки, дорогая запись с копированием |
| Частые чтения уникальных значений | `CopyOnWriteArraySet` | Set поверх copy-on-write подхода |
| Неблокирующая FIFO-очередь | `ConcurrentLinkedQueue` | `offer()` и `poll()` не ждут появления места или элемента |
| Неблокирующая двусторонняя очередь | `ConcurrentLinkedDeque` | добавление и извлечение с обоих концов |
| Producer–consumer с ожиданием | `BlockingQueue` | `put()` и `take()` могут ждать |
| Producer–consumer с двух концов | `BlockingDeque` | блокирующие операции с начала и конца |

## ConcurrentHashMap

`ConcurrentHashMap` выбирают, когда нескольким потокам нужен общий поиск по ключу:

```java
ConcurrentHashMap<String, Download> downloads =
    new ConcurrentHashMap<>();

downloads.put(id, download);
Download current = downloads.get(id);
downloads.computeIfAbsent(id, this::loadDownload);
```

Она не разрешает `null` в качестве ключа или значения. Это позволяет однозначно понимать результат `get() == null`: такого ключа сейчас нет.

Для сортировки по ключам существует `ConcurrentSkipListMap`. Она обычно дороже hash map, зато поддерживает `firstKey()`, `lastKey()`, `subMap()` и другие операции над диапазонами.

## CopyOnWriteArrayList

**Copy-on-write (копирование при записи)** означает, что каждая изменяющая операция создаёт новую копию внутреннего массива:

```java
CopyOnWriteArrayList<Listener> listeners =
    new CopyOnWriteArrayList<>();

listeners.add(listener);       // копируется массив
for (Listener item : listeners) {
    item.onEvent(event);       // чтение стабильного snapshot
}
```

Итератор читает **snapshot (снимок)** массива, существовавший в момент его создания. Он не увидит последующие изменения, зато не получит `ConcurrentModificationException`.

Эта коллекция подходит для списка обработчиков, конфигурации или подписчиков, когда чтений очень много, а добавления и удаления редки. Для часто изменяемого большого списка она не подходит: каждая запись копирует весь массив.

## ConcurrentLinkedQueue и ConcurrentLinkedDeque

`ConcurrentLinkedQueue` — неблокирующая FIFO-очередь:

```java
queue.offer(task);       // добавить в хвост
Task task = queue.poll(); // получить из головы или null
```

`poll()` не ждёт новый элемент, а сразу возвращает `null`, если очередь пуста. `ConcurrentLinkedDeque` дополнительно позволяет работать с обоими концами через `offerFirst()`, `offerLast()`, `pollFirst()` и `pollLast()`.

Такие очереди полезны, когда ожиданием и повторными попытками управляет само приложение. Если consumer должен спать до появления работы, удобнее `BlockingQueue`.

## BlockingQueue

**Blocking queue (блокирующая очередь)** соединяет producer (производителя) и consumer (потребителя):

```java
queue.put(task);  // ждёт, если ограниченная очередь заполнена
Task task = queue.take(); // ждёт, если очередь пуста
```

У интерфейса есть четыре семейства операций:

| Действие | Исключение | Специальное значение | Ждать | Ждать с timeout |
|---|---|---|---|---|
| Добавить | `add(e)` | `offer(e)` | `put(e)` | `offer(e, time, unit)` |
| Получить | `remove()` | `poll()` | `take()` | `poll(time, unit)` |
| Посмотреть | `element()` | `peek()` | — | — |

Основные реализации:

- `ArrayBlockingQueue` — ограниченная очередь на массиве; размер задаётся заранее;
- `LinkedBlockingQueue` — очередь на связанных узлах, может иметь ограничение размера;
- `PriorityBlockingQueue` — сначала выдаёт элемент с наивысшим приоритетом, а не самый старый;
- `DelayQueue` — выдаёт элемент только после истечения его задержки;
- `SynchronousQueue` — не хранит элементы: producer напрямую передаёт элемент ожидающему consumer;
- `LinkedTransferQueue` — позволяет при необходимости ждать, пока consumer действительно получит элемент;
- `LinkedBlockingDeque` — блокирующая очередь с операциями на обоих концах.

Для рабочего пула часто нужна ограниченная очередь. Она создаёт **backpressure (обратное давление)**: быстрые producers не могут бесконечно добавлять задачи и заполнять память.

## ConcurrentSkipListMap и ConcurrentSkipListSet

Эти коллекции хранят элементы отсортированными и основаны на skip list (списке с пропусками):

```java
ConcurrentNavigableMap<Long, Task> scheduled =
    new ConcurrentSkipListMap<>();

scheduled.put(deadline, task);
Map<Long, Task> ready = scheduled.headMap(now, true);
```

Их выбирают, когда одновременно нужны конкурентный доступ, сортировка и запросы диапазонов. Если порядок ключей не нужен, `ConcurrentHashMap` обычно проще.

## Synchronized wrappers — другой подход

`Collections.synchronizedList()` и `Collections.synchronizedMap()` создают **synchronized wrappers (синхронизированные обёртки)** над обычными коллекциями:

```java
List<String> values =
    Collections.synchronizedList(new ArrayList<>());
```

Обычно все операции такой обёртки используют один общий mutex. Во время обхода коллекции внешняя синхронизация всё равно необходима:

```java
synchronized (values) {
    for (String value : values) {
        use(value);
    }
}
```

Это отличается от специализированных concurrent collections, которые проектировались с учётом параллельного доступа и предоставляют собственные гарантии итераторов.

## Что видит итератор

У обычной изменяемой коллекции итератор часто является **fail-fast (быстро обнаруживающим изменение)** и может выбросить `ConcurrentModificationException`. Это диагностика ошибки использования, а не механизм потокобезопасности.

У большинства concurrent collections итераторы **weakly consistent (слабо согласованные)**: они не падают из-за конкурентного изменения, могут увидеть часть новых элементов и не обязаны показывать единый мгновенный снимок.

У copy-on-write коллекций итератор читает неизменяемый snapshot и не видит изменений, сделанных после его создания.

## Как выбрать коллекцию

Задай вопросы:

1. Нужен доступ по ключу, порядок или очередь?
2. Должен ли consumer ждать появления элемента?
3. Нужно ли ограничить размер и создать backpressure?
4. Как часто происходят чтения и записи?
5. Нужны ли сортировка и диапазоны?
6. Какую картину должен видеть итератор?
7. Требуется одна операция или атомарная композиция нескольких действий?

```text
ключ → ConcurrentHashMap
ключи по порядку → ConcurrentSkipListMap
много чтений, мало записей → CopyOnWriteArrayList
очередь без ожидания → ConcurrentLinkedQueue
очередь с ожиданием → BlockingQueue
```

> **Главная мысль:** потокобезопасная коллекция не бывает «лучшей вообще». Её контракт должен совпадать с нужными порядком, ожиданием, частотой записей и границей атомарной операции.

## Дальше

Для нашего счётчика нужен быстрый доступ по ключу без сортировки и ожидания. Из общей карты коллекций выберем `ConcurrentHashMap` и разберём её отдельно.

---

← [synchronizedMap: безопасная очередь](./14-synchronized-map.md) · [Зачем ConcurrentHashMap](./15-concurrent-hash-map.md) →
