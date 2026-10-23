# A Lambda-shaped image that a foreign uid can start: it serves /healthz on
# 8080 as uid 65532 and starts from /.
FROM busybox:1.37
RUN mkdir -p /srv && echo ok > /srv/healthz && chmod 0644 /srv/healthz
USER 65532:65532
WORKDIR /
EXPOSE 8080
ENTRYPOINT ["httpd", "-f", "-p", "8080", "-h", "/srv"]
