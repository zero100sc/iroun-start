# ── 멀티스테이지: Maven 빌드 → JRE 실행 (로컬 JDK 불필요) ──
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/hwpx-service.jar app.jar
ENV PORT=8090
EXPOSE 8090
CMD ["java", "-jar", "app.jar"]
