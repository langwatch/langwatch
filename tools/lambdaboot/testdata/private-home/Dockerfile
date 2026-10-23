# The image that shipped: like ./good, but it starts in a home directory of
# mode 0700 that only uid 65532 may enter, as the distroless nonroot base
# does. Lambda runs the image as its own uid, which cannot enter it.
FROM busybox:1.37
RUN mkdir -p /srv && echo ok > /srv/healthz && chmod 0644 /srv/healthz \
 && mkdir -p /home/nonroot && chown 65532:65532 /home/nonroot && chmod 0700 /home/nonroot
USER 65532:65532
WORKDIR /home/nonroot
EXPOSE 8080
ENTRYPOINT ["httpd", "-f", "-p", "8080", "-h", "/srv"]
