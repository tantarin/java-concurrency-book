# Зачем ConcurrentHashMap

> Конкурентная коллекция

← [Какие конкурентные коллекции есть в Java](./15-concurrent-collections-overview.md) · [Почему get и put недостаточно](./16-operation-composition.md) →

`ConcurrentHashMap` предназначена для работы нескольких потоков. Она не сводит все чтения и обновления к одному общему монитору, поэтому независимые операции обычно меньше блокируют друг друга.

```java
Map<String, Integer> views =
    new ConcurrentHashMap<>();
```

Её отдельные методы имеют потокобезопасный контракт: поток не повредит внутреннюю структуру Map, пока другой выполняет разрешённую конкурентную операцию.

Но слово «потокобезопасная» легко понять слишком широко. Оно относится к операциям коллекции, а не автоматически к любому алгоритму из нескольких вызовов.

> ConcurrentHashMap не может догадаться, какие строки нашего кода должны считаться одной бизнес-операцией.

## В живом проекте

- [Почему для реестра выбран `ConcurrentHashMap`](https://github.com/tantarin/java-concurrency-examples/tree/3310155b8eedbdc69e8b78c03efd2bc8bfb37d2f/collections/concurrent-hash-map-download-registry)
- [Конкретная реализация реестра](https://github.com/tantarin/java-concurrency-examples/blob/3310155b8eedbdc69e8b78c03efd2bc8bfb37d2f/collections/concurrent-hash-map-download-registry/src/main/java/io/github/tantarin/concurrency/downloads/DownloadRegistry.java#L8-L20)
- [Конкурентный тест `computeIfAbsent()`](https://github.com/tantarin/java-concurrency-examples/blob/3310155b8eedbdc69e8b78c03efd2bc8bfb37d2f/collections/concurrent-hash-map-download-registry/src/test/java/io/github/tantarin/concurrency/downloads/DownloadRegistryTest.java#L19-L52)

## Дальше

Проверим старый код get → вычисление → put. Потерянный инкремент неожиданно вернётся.

---

← [Какие конкурентные коллекции есть в Java](./15-concurrent-collections-overview.md) · [Почему get и put недостаточно](./16-operation-composition.md) →
