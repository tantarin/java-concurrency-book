# Зачем ConcurrentHashMap

> Конкурентная коллекция

← [synchronizedMap: безопасная очередь](./14-synchronized-map.md) · [Какие конкурентные коллекции есть в Java](./15-concurrent-collections-overview.md) →

`ConcurrentHashMap` предназначена для работы нескольких потоков. Она не сводит все чтения и обновления к одному общему монитору, поэтому независимые операции обычно меньше блокируют друг друга.

```java
Map<String, Integer> views =
    new ConcurrentHashMap<>();
```

Её отдельные методы имеют потокобезопасный контракт: поток не повредит внутреннюю структуру Map, пока другой выполняет разрешённую конкурентную операцию.

Но слово «потокобезопасная» легко понять слишком широко. Оно относится к операциям коллекции, а не автоматически к любому алгоритму из нескольких вызовов.

> ConcurrentHashMap не может догадаться, какие строки нашего кода должны считаться одной бизнес-операцией.

## В живом проекте

- [Реестр загрузок и задач](https://github.com/tantarin/java-concurrency-lab/blob/11c72fc3beda43fd3e744c2eedbf6e60bc93a9f6/downloader/src/main/java/io/github/tantarin/downloader/DownloadManager.java#L15-L21)

## Дальше

Расширим картину: кроме Map, в Java есть конкурентные списки, множества и несколько семейств очередей.

---

← [synchronizedMap: безопасная очередь](./14-synchronized-map.md) · [Какие конкурентные коллекции есть в Java](./15-concurrent-collections-overview.md) →
